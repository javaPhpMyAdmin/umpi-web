import { memo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Modal from '../../../components/ui/Modal'
import { useAuth } from '../../../contexts/AuthContext'
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
} from '../../../hooks/useNotifications'
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll'
import { timeAgo } from '../../../lib/utils'
import type { Notification } from '../../../types'

// --- Helpers ---

function NotificationIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'review':
      return (
        <span className="material-symbols-outlined text-[20px] text-[#F59E0B]">
          star
        </span>
      )
    case 'message':
      return (
        <span className="material-symbols-outlined text-[20px] text-primary-container">
          chat_bubble
        </span>
      )
    default:
      return (
        <span className="material-symbols-outlined text-[20px] text-[#8B5CF6]">
          card_membership
        </span>
      )
  }
}

// --- Memoized list item ---

type NotificationItemProps = {
  notification: Notification
  onTap: (id: string, isRead: boolean, data: Record<string, any>) => void
  onDelete: (id: string, title: string) => void
}

const NotificationItem = memo(function NotificationItem({
  notification,
  onTap,
  onDelete,
}: NotificationItemProps) {
  const { id, type, title, body, is_read, created_at, data } = notification

  return (
    <div
      onClick={() => onTap(id, is_read, data)}
      className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors border-b border-border-light ${
        !is_read ? 'bg-[#FFF8F5]' : 'bg-surface hover:bg-surface-container-low'
      }`}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-full bg-background flex items-center justify-center shrink-0">
        <NotificationIcon type={type} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center gap-2 mb-0.5">
          <span
            className={`font-body-base text-body-base truncate ${
              !is_read ? 'font-bold text-on-surface' : 'font-medium text-on-surface'
            }`}
          >
            {title}
          </span>
          <span className="font-small-subtext text-small-subtext text-text-muted shrink-0">
            {timeAgo(created_at)}
          </span>
        </div>
        <p className="font-body-base text-body-sm text-text-secondary line-clamp-2">
          {body}
        </p>
      </div>

      {/* Unread dot */}
      {!is_read && (
        <div className="w-2 h-2 rounded-full bg-primary-container shrink-0" />
      )}

      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(id, title)
        }}
        className="shrink-0 p-2 rounded-full text-text-muted hover:text-error hover:bg-error-container transition-colors opacity-0 group-hover:opacity-100"
        title="Eliminar notificación"
      >
        <span className="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
  )
})

// --- Page ---

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { session } = useAuth()

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNotifications(session?.user?.id)

  const markAsRead = useMarkAsRead()
  const markAllAsRead = useMarkAllAsRead()
  const deleteNotification = useDeleteNotification()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const notifications = data?.pages.flat() ?? []

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore: !!hasNextPage,
    isLoading: isFetchingNextPage,
  })

  function handleTap(id: string, isRead: boolean, itemData: Record<string, any>) {
    if (!isRead) {
      markAsRead.mutate(id)
    }

    const { listing_id, conversation_id } = itemData ?? {}
    if (conversation_id) {
      navigate(`/mensajes?conversation=${conversation_id}`)
    } else if (listing_id) {
      navigate(`/producto/${listing_id}`)
    }
    // subscription_expiring → solo marcar como leída, no navegar
  }

  function handleDelete(id: string, title: string) {
    setDeleteTarget({ id, title })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deleteNotification.mutate(deleteTarget.id)
    setDeleteTarget(null)
  }

  function handleMarkAllAsRead() {
    if (session?.user?.id) {
      markAllAsRead.mutate(session.user.id)
    }
  }

  if (!session) {
    return (
      <div className="bg-background text-on-background font-body-base text-body-base antialiased min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-secondary text-lg mb-4">
              Debes iniciar sesión para ver tus notificaciones
            </p>
            <a
              href="/login"
              className="bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors"
            >
              Iniciar Sesión
            </a>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-background text-on-background font-body-base text-body-base antialiased min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-2xl mx-auto px-margin-mobile md:px-margin-desktop py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-header-lg text-header-lg text-on-surface">
            Notificaciones
          </h1>
          {notifications.length > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-primary-container font-label-bold text-label-bold hover:text-primary-dark transition-colors"
            >
              Todo leído
            </button>
          )}
        </div>

        {/* Notifications list */}
        <div className="bg-surface rounded-2xl border border-border-light overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-xxl">
              <div className="text-text-secondary">Cargando...</div>
            </div>
          ) : notifications.length > 0 ? (
            <>
              {notifications.map((notification) => (
                <div key={notification.id} className="group">
                  <NotificationItem
                    notification={notification}
                    onTap={handleTap}
                    onDelete={handleDelete}
                  />
                </div>
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-1" />

              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-6">
                  <div className="text-text-secondary text-sm">Cargando mas...</div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-xxl text-center">
              <span className="material-symbols-outlined text-6xl text-text-muted mb-4">
                notifications_none
              </span>
              <h3 className="font-header-md text-header-md text-on-surface mb-2">
                Sin notificaciones
              </h3>
              <p className="font-body-base text-body-base text-text-secondary max-w-xs">
                Cuando alguien te califique o tu suscripcion este por vencer, te avisamos aca
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Eliminar notificacion"
        message={`Estas seguro de que queres eliminar "${deleteTarget?.title}"?`}
        confirmLabel="Eliminar"
        danger
        loading={deleteNotification.isPending}
      />
    </div>
  )
}
