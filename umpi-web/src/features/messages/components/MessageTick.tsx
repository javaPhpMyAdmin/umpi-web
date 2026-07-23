interface MessageTickProps {
  isRead: boolean
}

/**
 * WhatsApp-style read receipt ticks for sent messages.
 *
 * - Unread (isRead=false): single grey checkmark
 * - Read (isRead=true): double blue checkmark
 *
 * Only rendered on messages sent by the current user.
 */
export default function MessageTick({ isRead }: MessageTickProps) {
  return (
    <span
      className="material-symbols-outlined align-middle"
      style={{
        fontSize: '16px',
        color: isRead ? '#2563eb' : '#95a5a6',
        verticalAlign: 'middle',
        marginLeft: '4px',
      }}
    >
      {isRead ? 'done_all' : 'done'}
    </span>
  )
}
