# Read Receipts (Blue Ticks) Specification

## Purpose

WhatsApp-style read receipts for 1:1 chat. The sender sees whether the other participant has read their messages, indicated by tick icon color. No new database columns are introduced — the feature derives read state from existing `user1_last_read_at` / `user2_last_read_at` columns on the `conversations` table.

## Requirements

### Requirement: Tick Display

The system MUST render a tick icon on messages sent by the current user. The icon MUST be a single grey checkmark (`check` Material Symbol) for unread messages and a double blue checkmark (`done_all`) for read messages.

#### Scenario: Sent message shows single grey tick

- GIVEN User A sends a message to User B
- WHEN the message bubble renders for User A
- THEN a single grey tick icon appears next to the message timestamp

#### Scenario: Read message shows double blue tick

- GIVEN User A sent a message and User B has since opened the conversation
- WHEN the message bubble renders for User A
- THEN a double blue tick icon appears next to the message timestamp

#### Scenario: Received messages show no tick

- GIVEN User B receives a message from User A
- WHEN the message bubble renders for User B
- THEN NO tick icon appears on the message

---

### Requirement: Read State Derivation

The system MUST determine read state by comparing `message.created_at` against the other participant's `last_read_at` timestamp. A message is read when `message.created_at <= other_user_last_read_at`.

#### Scenario: Message sent before last read is marked read

- GIVEN User A sent a message at 10:00 and User B last read the conversation at 10:05
- WHEN User A views the conversation
- THEN the message displays as read (double blue tick)

#### Scenario: Message sent after last read is marked unread

- GIVEN User A sent a message at 10:10 and User B last read the conversation at 10:05
- WHEN User A views the conversation
- THEN the message displays as unread (single grey tick)

#### Scenario: No read timestamp exists

- GIVEN a conversation has no read history (both `userX_last_read_at` are NULL)
- WHEN either user views the conversation
- THEN all messages display as unread

---

### Requirement: Mark as Read

When the current user opens or views a conversation, the system MUST update that user's `userX_last_read_at` timestamp on the `conversations` row to the current time.

#### Scenario: Opening a conversation marks it read

- GIVEN User B navigates to a conversation with User A
- WHEN the conversation loads
- THEN the system updates `userB_last_read_at` (or `user1_last_read_at` / `user2_last_read_at` based on user position) to the current timestamp

#### Scenario: Mark-as-read also marks notifications

- GIVEN User B opens a conversation that has unread notification records
- WHEN mark-as-read executes
- THEN both the conversation read timestamp AND notification `is_read` flags are updated in the same operation

---

### Requirement: Real-time Tick Updates

The system MUST subscribe to UPDATE events on the `conversations` table filtered by the active conversation ID. When a read timestamp changes, the system MUST update the local conversation cache so ticks re-render without requiring a page refresh.

#### Scenario: Ticks flip to blue in real-time when other user reads

- GIVEN User A has a conversation open with unread messages showing grey ticks
- WHEN User B opens the same conversation on their device
- THEN User A's grey ticks transition to blue ticks within 2 seconds without a page reload

#### Scenario: Real-time event for different conversation is ignored

- GIVEN User A has Conversation X open
- WHEN a read-timestamp UPDATE arrives for Conversation Y
- THEN no re-render occurs on User A's screen

---

### Requirement: Tick Visibility Scope

Ticks MUST only appear on the current user's own sent messages. The system MUST identify the current user via `sender_id` and only render the `MessageTick` component when `sender_id` matches the authenticated user.

#### Scenario: Only sender sees ticks in their messages

- GIVEN User A sent 3 messages and User B sent 2 messages in a conversation
- WHEN User A views the conversation
- THEN ticks appear on User A's 3 messages and NO ticks appear on User B's 2 messages

---

## Out of Scope

- **Delivered state** (double grey tick): Deferred to v2. Single grey tick = sent.
- **Group chat read receipts**: No group chat feature exists.
- **Privacy toggle**: No option to hide read receipts.
- **Typing indicators**: Separate feature.
- **Unread message badge**: Existing `unread_count` field is unchanged.
- **Multi-tab synchronization**: Not a concern for v1.
- **Mobile tick component**: Mobile uses same logic but separate component implementation.

## Non-functional Requirements

| Metric | Target |
|--------|--------|
| Tick render latency | No perceptible delay on message load |
| Real-time tick flip | ≤ 2 seconds from read event |
| Query overhead | Zero additional queries on message list (read timestamps come from existing conversation fetch) |
| Scale | ≤ 5,000 concurrent users (Supabase Realtime limit well above this) |

## Acceptance Criteria

1. Sent messages show a single grey tick icon.
2. Read messages show a double blue tick icon.
3. Received messages show no tick icon.
4. Opening a conversation updates `userX_last_read_at` on the conversations row.
5. Web mark-as-read updates both notification records AND the conversation read timestamp.
6. Ticks flip to blue in real-time (≤ 2 seconds) when the other user reads.
7. Real-time subscription is scoped to the active conversation only.
8. `pnpm build` passes with no type errors.
9. No regression in message sending, loading, or infinite scroll behavior.
