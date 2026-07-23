# Design: Blue Tick Read Receipts

## Technical Approach

Derive read state from existing `user1_last_read_at` / `user2_last_read_at` columns on the `conversations` table. No new DB columns. When a user opens a conversation, update their `userX_last_read_at` to `now()`. For each sent message bubble, compare `message.created_at <= other_user_last_read_at` to determine tick color. Subscribe to `conversations` table UPDATE events for real-time tick flips.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Read state storage | New per-message column vs existing conversation timestamps | New column = more queries, migration; existing timestamps = zero queries, derivation only | **Existing timestamps** — zero query overhead, no migration |
| Realtime subscription target | Subscribe to conversations UPDATE vs poll | Subscribe = instant ticks, one channel; poll = delayed, wastes bandwidth | **Subscribe to conversations UPDATE** — spec requires ≤2s tick flip |
| Mark-as-read mechanism | RPC (like mobile) vs direct client update | RPC = single atomic operation, server-controlled; client update = two separate writes | **RPC for web too** — atomic, matches mobile, fixes current bug where notifications aren't synced |
| Tick component extraction | Inline in message bubbles vs separate component | Separate = testable, reusable, single responsibility; inline = simpler but bloated MessagesPage | **Separate MessageTick component** — MessagesPage is already 575 lines |
| Realtime integration point | New hook vs extend useRealtimeConversations | New hook = clean separation; extend = polluted polling hook | **New hook: useRealtimeReadReceipts** — focused, subscribe-only, no polling |

## Data Flow

### Message Sent → Displayed → Read → Tick Updates

```
1. User A sends message
   → INSERT INTO messages (conversation_id, sender_id, content)
   → useRealtimeMessages catches INSERT → adds to React Query cache
   → MessageTick renders: single grey tick (other_user_last_read_at < msg.created_at)

2. User B opens conversation
   → RPC mark_conversation_read(conversation_id) fires
   → DB UPDATE: user2_last_read_at = now()  [atomic: both timestamps in one call]
   → DB UPDATE: notifications SET is_read = true WHERE conversation_id = ...
   → Realtime: conversations UPDATE event fires

3. User A receives realtime UPDATE
   → useRealtimeReadReceipts catches UPDATE for active conversation
   → Updates conversations React Query cache with new user2_last_read_at
   → MessageTick re-renders: double blue tick (other_user_last_read_at >= msg.created_at)
```

### Realtime Architecture

```
┌─────────────────────────────────────────────────┐
│  Supabase Realtime                              │
│                                                 │
│  Channel: conversations:{conversationId}        │
│  Filter: UPDATE on conversations table           │
│  Payload: { new: { user1_last_read_at,          │
│                     user2_last_read_at, ... } }  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│  useRealtimeReadReceipts (NEW hook)              │
│  - Subscribes to conversations UPDATE            │
│  - Filters: only update if convId matches active │
│  - Updates React Query cache for 'conversations' │
│  - Re-renders MessageTick components             │
└─────────────────────────────────────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/types/index.ts` | Modify | Add `user1_last_read_at` and `user2_last_read_at` fields to `Conversation` interface |
| `src/hooks/useRealtimeReadReceipts.ts` | **Create** | Subscribe to conversations UPDATE events for active conversation; update React Query cache |
| `src/hooks/useNotifications.ts` | Modify | `useMarkMessageReadByConversation` must ALSO call `mark_conversation_read` RPC to update `userX_last_read_at` on conversations table |
| `src/features/messages/components/MessageTick.tsx` | **Create** | Single/double tick icon component: grey `check` for unread, blue `done_all` for read |
| `src/features/messages/pages/MessagesPage.tsx` | Modify | Import MessageTick, pass `selectedConversation` and `userId` to determine other_user_last_read_at, render ticks on sent messages |
| `app/chat/useMessages.ts` (mobile) | Modify | Ensure `mark_conversation_read` RPC is called on conversation open (verify existing behavior) |

## Interfaces / Contracts

### Conversation type update

```typescript
// src/types/index.ts
export interface Conversation {
  id: string
  listing_id: string | null
  user1_id: string
  user2_id: string
  last_message_at: string
  created_at: string
  archived_by: string[]
  user1_last_read_at: string | null  // NEW
  user2_last_read_at: string | null  // NEW
  listing?: Listing
  other_user?: Profile
  last_message?: Message
  unread_count?: number
}
```

### MessageTick component

```typescript
// src/features/messages/components/MessageTick.tsx
interface MessageTickProps {
  isRead: boolean  // true if other_user_last_read_at >= message.created_at
}

// Renders:
// isRead=false → <span class="material-symbols-outlined">check</span> in grey
// isRead=true  → <span class="material-symbols-outlined">done_all</span> in blue
```

### useRealtimeReadReceipts hook

```typescript
// src/hooks/useRealtimeReadReceipts.ts
export function useRealtimeReadReceipts(
  conversationId: string | null,
  currentUserId: string | null
): void
```

### Mark-as-read RPC contract

```sql
-- mark_conversation_read(p_conversation_id uuid)
-- Sets user1_last_read_at or user2_last_read_at to now()
-- depending on which user_id matches auth.uid()
-- Also marks related notifications as read
SELECT mark_conversation_read($1);
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | `pnpm build` passes | Automated — verify phase |
| Unit | MessageTick renders correct icon/color for isRead true/false | Manual visual inspection |
| Integration | mark_conversation_read RPC updates correct timestamp | Manual: open conversation on two accounts, verify tick state |
| Realtime | Ticks flip in ≤2s when other user reads | Manual: open conversation on two browser tabs, verify real-time update |
| Regression | Message sending, loading, infinite scroll unaffected | Manual smoke test |

## Migration / Rollout

No DB migration required — `user1_last_read_at` and `user2_last_read_at` already exist on the `conversations` table. However:

### Supabase Realtime Setup

Enable Realtime on the `conversations` table (if not already enabled):

```sql
-- Supabase Dashboard → Database → Replication → Enable for 'conversations'
-- OR via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
```

### RPC Deployment

Verify `mark_conversation_read` RPC exists. If not, create it:

```sql
CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id uuid)
RETURNS void AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  UPDATE conversations
  SET user1_last_read_at = CASE WHEN user1_id = v_user_id THEN now() ELSE user1_last_read_at END,
      user2_last_read_at = CASE WHEN user2_id = v_user_id THEN now() ELSE user2_last_read_at END
  WHERE id = p_conversation_id;

  UPDATE notifications
  SET is_read = true
  WHERE user_id = v_user_id
    AND type = 'message'
    AND is_read = false
    AND data->>'conversation_id' = p_conversation_id::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Rollback

- Remove MessageTick component and all tick rendering from MessagesPage
- Revert useNotifications.ts changes (useMarkMessageReadByConversation goes back to notification-only)
- Remove useRealtimeReadReceipts.ts
- Revert Conversation type additions

No data to rollback — feature uses existing columns.

## Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Both `userX_last_read_at` are NULL | `other_user_last_read_at` is null → comparison returns false → all messages show grey tick |
| User opens own conversation (self-chat) | Not possible — conversations require two distinct users |
| Multi-tab | Both tabs show same ticks (reads from same conversation state). Spec marks multi-tab sync as out of scope for v1 |
| Archived conversations | No special handling — archived conversations can still be opened and ticks work normally |
| mark_conversation_read RPC fails | Notification mark-as-read still succeeds (independent call). Ticks stay grey until retry. No user-visible error |
| Realtime connection drops | 15s polling fallback via useRealtimeConversations already invalidates conversations cache. Ticks update on next poll cycle |
| Message created_at vs last_read_at race | If message is sent at exact same millisecond as mark_read, `<=` comparison marks it read. Acceptable edge case |

## Open Questions

- [ ] Does `mark_conversation_read` RPC already exist in the Supabase project? Mobile code references it — need to verify via Dashboard or SQL editor
- [ ] Is Realtime already enabled on the `conversations` table? Check Supabase Dashboard → Replication
- [ ] Should `useMarkMessageReadByConversation` call the RPC directly, or should we create a separate `useMarkConversationRead` hook? (I recommend separate — single responsibility)
