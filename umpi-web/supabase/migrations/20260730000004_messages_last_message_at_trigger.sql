-- Migration: server-enforced conversations.last_message_at on message insert
-- Date: 2026-07-30
-- Purpose: last_message_at was maintained client-side (the Messages page
--          manually UPDATE'd the conversation after each message insert),
--          which made the value racy and allowed the client to set any value.
--          This trigger sets it on the DB side for every message insert.
--
--          Additive: co-exists with trg_create_message_notification (the
--          notification trigger on the same table) — both are AFTER INSERT
--          row triggers on messages and are independent of each other.
--
--          NOTE: the conversations table has NO `last_message` content column
--          (only id, listing_id, user1_id, user2_id, last_message_at,
--          created_at, archived_by, user1_last_read_at, user2_last_read_at),
--          so the trigger only touches last_message_at.

CREATE OR REPLACE FUNCTION public.fn_touch_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = now()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;

CREATE TRIGGER trg_messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_touch_conversation_on_message();
