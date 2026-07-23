# Proposal: Blue Tick Read Receipts

## Intent

Users cannot tell whether the other person has read their messages. The `conversations` table already has `user1_last_read_at` and `user2_last_read_at` columns, but nothing reads or reacts to them on the web client. The mobile client calls `mark_conversation_read` RPC but the web client only marks notification records. This gap makes conversations feel one-sided and reduces engagement confidence.

## Scope

### In Scope
- Add `user1_last_read_at` / `user2_last_read_at` to the `Conversation` type
- Fix `useMarkMessageReadByConversation` to also update the conversation's `userX_last_read_at` timestamp (web currently skips this)
- Create a `MessageTick` component: single grey tick (sent) / double blue tick (read by other user)
- Inject tick icons into `MessagesPage.tsx` message bubbles — only for sent messages (`sender_id === current user`)
- Create `useRealtimeConversationRead` hook: subscribe to UPDATE events on the `conversations` table filtered by the active conversation ID. On event, update the React Query cache for `conversations` with the new read timestamp → ticks flip to blue in real-time
- Tick logic: `message.created_at <= conversation.other_user_last_read_at` → blue; otherwise grey
- Wire mobile app (`umpi-app/app/chat/`) with the same tick component and the same read-pointer update (if mobile is in scope this iteration)

### Out of Scope
- "Delivered" state (double grey tick before read) — deferred to v2; current single grey tick = sent is sufficient
- Read receipts for group chats (no group chat feature exists yet)
- Privacy toggle to hide read receipts (can add later)
- Typing indicators (separate feature)
- Unread message count badge per conversation (exists in `unread_count` field, not changing)

## Capabilities

### New Capabilities
- `read-receipts`: Blue tick read receipts using conversation-level read pointers — tick rendering, read-timestamp tracking, and real-time subscription for tick state updates

### Modified Capabilities
- None — no existing specs in `openspec/specs/` to modify

## Approach

1. **Type update**: Add `user1_last_read_at` and `user2_last_read_at` (nullable `string | null`) to the `Conversation` interface
2. **Mark-as-read fix**: Update `useMarkMessageReadByConversation` mutation to perform TWO writes: (a) mark notifications as read (existing), (b) `update({ userX_last_read_at: new Date().toISOString() })` on the conversations row where X matches the current user
3. **MessageTick component**: Pure presentational component accepting `isSent`, `isRead`, renders Material Symbols icons (`check` for single tick, `done_all` for double, colored `text-primary-container` when read, `text-text-muted` otherwise)
4. **Tick injection**: In `MessagesPage.tsx` message bubble, append `<MessageTick>` inside the timestamp row for sent messages
5. **Read pointer fetch**: `useMessages` query already does `select('*')` on messages, but we also need the conversation's read timestamps. Two options:
   - **Option A**: Fetch the conversation row separately when a conversation is selected (already happens in `useConversations`) — pass `other_user_last_read_at` down as a prop
   - **Option B**: Add a second query `useConversationReadPointer(conversationId)` that fetches just the read timestamps
   - **Recommendation**: Option A — the conversation data is already loaded in `useConversations`. The `selectedConversation` object already contains the raw row data. We just need the type to include the fields.
6. **Realtime read pointer**: New `useRealtimeConversationRead` hook subscribes to `postgres_changes` UPDATE on `conversations` table filtered by `id=eq.{conversationId}`. On event, update the `conversations` query cache with the new timestamp, causing ticks to re-render as blue
7. **Web-only scope**: Mobile app can be updated separately; the DB-level changes (RPC + columns) already exist

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/types/index.ts` | Modified | Add `user1_last_read_at`, `user2_last_read_at` to `Conversation` interface |
| `src/hooks/useNotifications.ts` | Modified | `useMarkMessageReadByConversation` adds conversation timestamp update |
| `src/features/messages/components/MessageTick.tsx` | New | Presentational tick icon component |
| `src/features/messages/pages/MessagesPage.tsx` | Modified | Render `<MessageTick>` in sent message bubbles |
| `src/hooks/useRealtimeConversationRead.ts` | New | Subscribe to conversation UPDATE events for read pointer |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Supabase Realtime UPDATE events may have latency or be throttled | Low | 5000-user scale is well within Supabase limits; fallback is that ticks update on next conversation open |
| Concurrent open sessions could race on `last_read_at` writes | Low | Timestamps are monotonic — later write always wins correctly; no conflict |
| Web `useConversations` fetches `select('*')` — read timestamps may not be in RLS-visible columns | Medium | Verify RLS allows current user to see both `user1_last_read_at` and `user2_last_read_at`; if not, use a DB view or RPC |
| Tick flicker if realtime event arrives mid-render | Low | React Query cache update is synchronous; tick state derives from stable cache values |

## Rollback Plan

- Remove `MessageTick` component and its usage in `MessagesPage.tsx`
- Revert `useMarkMessageReadByConversation` to notification-only update
- Remove `useRealtimeConversationRead` hook and its subscription
- No DB migration to rollback — columns and RPC already exist and are additive
- No data corruption risk — all changes are read-side only (except the extra `UPDATE` call in mark-as-read, which is safe)

## Dependencies

- Supabase Realtime must be enabled on the `conversations` table (Dashboard → Database → Replication → Enable for `conversations`)
- Existing `user1_last_read_at` / `user2_last_read_at` columns must exist in the `conversations` table (confirmed in exploration)

## Success Criteria

- [ ] Sent messages show a single grey tick
- [ ] When the other user opens the conversation, sent messages transition to double blue ticks within 2 seconds (real-time)
- [ ] Ticks are only shown on the sender's own messages (no ticks on received messages)
- [ ] Web mark-as-read updates both notifications AND `userX_last_read_at`
- [ ] `pnpm build` passes with no type errors
- [ ] No regression in message sending, loading, or infinite scroll behavior
