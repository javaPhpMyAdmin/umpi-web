# Tasks: Blue Tick Read Receipts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 200–300 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

---

## Phase 1: Database Verification

- [x] 1.1 Verify `mark_conversation_read` RPC exists in Supabase. Run `SELECT proname FROM pg_proc WHERE proname = 'mark_conversation_read'` in SQL editor. If missing, create it using the SQL from design.md (lines 157–175).
- [x] 1.2 Verify Realtime replication is enabled on `conversations` table. Check Supabase Dashboard → Database → Replication. If not enabled, run `ALTER PUBLICATION supabase_realtime ADD TABLE conversations;`

## Phase 2: Web — Types & Component

- [x] 2.1 Add `user1_last_read_at: string | null` and `user2_last_read_at: string | null` to the `Conversation` interface in `src/types/index.ts`.
- [x] 2.2 Create `src/features/messages/components/MessageTick.tsx` — renders single grey `check` (unread) or double blue `done_all` (read) based on `isRead: boolean` prop. Use Material Symbols (`material-symbols-outlined`).
- [x] 2.3 Create `src/hooks/useRealtimeReadReceipts.ts` — subscribes to `conversations` UPDATE events for the active conversation via Supabase Realtime channel. On UPDATE, invalidates the React Query `conversations` cache so ticks re-render.

## Phase 3: Web — Integration

- [x] 3.1 Modify `src/hooks/useNotifications.ts` — update `useMarkMessageReadByConversation` to ALSO call `supabase.rpc('mark_conversation_read', { p_conversation_id })` alongside the existing notification mark-as-read logic.
- [x] 3.2 Modify `src/features/messages/pages/MessagesPage.tsx` — import `MessageTick` and `useRealtimeReadReceipts`. For each message where `sender_id === currentUserId`, render `<MessageTick isRead={message.created_at <= other_user_last_read_at} />` next to the timestamp. Call `useRealtimeReadReceipts(conversationId, userId)`.

## Phase 4: Mobile — Integration

- [x] 4.1 Create `components/MessageTick.tsx` in the mobile app — same logic as web version but using React Native components (e.g., `@expo/vector-icons` Ionicons `checkmark` / `checkmark-done`). Props: `isRead: boolean`.
- [x] 4.2 Modify `app/chat/[id].tsx` — import `MessageTick`, render it on sent messages (`sender_id === currentUserId`) next to the timestamp, using the other user's `last_read_at` from the conversation object.
- [x] 4.3 Verify `hooks/useMessages.ts` already calls `mark_conversation_read` RPC on conversation open. If not, add the RPC call.

## Phase 5: Testing

- [x] 5.1 `pnpm build` passes with no TypeScript errors (web).
- [ ] 5.2 Manual test: open conversation on two browser tabs (different accounts). Send message → single grey tick. Switch to receiver tab, open conversation → ticks flip to blue on sender tab within 2s.
- [ ] 5.3 Manual test: send multiple messages, verify only the current user's sent messages show ticks; received messages show no ticks.
- [ ] 5.4 Manual test: verify message sending, loading, and infinite scroll still work (no regression).
- [ ] 5.5 Manual test: mobile — open conversation on device, verify ticks render and mark-as-read works. Test on iOS and Android if possible.
