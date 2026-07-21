import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import type { Conversation, Message } from '../../../types'
import Navbar from '../../../components/layout/Navbar'
import Avatar from '../../../components/ui/Avatar'
import Modal from '../../../components/ui/Modal'
import { useAuth } from '../../../contexts/AuthContext'
import { useRealtimeMessages } from '../../../hooks/useRealtimeMessages'
import { useRealtimeConversations } from '../../../hooks/useRealtimeConversations'
import { useMarkMessageReadByConversation } from '../../../hooks/useNotifications'
import { timeAgo } from '../../../lib/utils'

const CONV_PAGE_SIZE = 30

function useConversations() {
  const { session } = useAuth()

  return useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: async ({ pageParam }) => {
      if (!session?.user?.id) return { items: [], nextCursor: null }

      let query = supabase
        .from('conversations')
        .select('*')
        .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
        .order('last_message_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CONV_PAGE_SIZE + 1) // fetch one extra to know if there's more

      // Cursor: compound (last_message_at, id) for stable pagination
      if (pageParam) {
        query = query.or(
          `and(last_message_at.lt.${pageParam.last_message_at}),and(last_message_at.eq.${pageParam.last_message_at},id.lt.${pageParam.id})`
        )
      }

      const { data: convs, error: convError } = await query

      if (convError) throw convError
      if (!convs || convs.length === 0) return { items: [], nextCursor: null }

      // Check if there's a next page
      const hasMore = convs.length > CONV_PAGE_SIZE
      const items = hasMore ? convs.slice(0, CONV_PAGE_SIZE) : convs
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore
        ? { last_message_at: lastItem.last_message_at, id: lastItem.id }
        : null

      // Batch-fetch related data
      const userIds = [...new Set(items.flatMap((c) => [c.user1_id, c.user2_id]))]
      const listingIds = items.filter((c) => c.listing_id).map((c) => c.listing_id)
      const convIds = items.map((c) => c.id)

      const [profilesRes, listingsRes, lastMessagesRes] = await Promise.all([
        userIds.length > 0
          ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds)
          : { data: [], error: null },
        listingIds.length > 0
          ? supabase.from('listings').select('id, title, price, images').in('id', listingIds)
          : { data: [], error: null },
        convIds.length > 0
          ? supabase
              .from('messages')
              .select('*')
              .in('conversation_id', convIds)
              .order('created_at', { ascending: false })
              .limit(100)
          : { data: [], error: null },
      ])

      const profilesMap = new Map((profilesRes.data || []).map((p) => [p.id, p]))
      const listingsMap = new Map((listingsRes.data || []).map((l) => [l.id, l]))

      const lastMsgByConv = new Map<string, Message>()
      for (const msg of (lastMessagesRes.data || []) as Message[]) {
        if (!lastMsgByConv.has(msg.conversation_id)) {
          lastMsgByConv.set(msg.conversation_id, msg)
        }
      }

      return {
        items: items.map((c) => ({
          ...c,
          other_user: profilesMap.get(c.user1_id === session.user.id ? c.user2_id : c.user1_id),
          listing: c.listing_id ? listingsMap.get(c.listing_id) : undefined,
          last_message: lastMsgByConv.get(c.id),
        })) as Conversation[],
        nextCursor,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as { last_message_at: string; id: string } | null,
    enabled: !!session?.user?.id,
    staleTime: 30_000,
  })
}

function useMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return { items: [], nextCursor: null }

      // Fetch newest first with LIMIT, cursor-based
      let query = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50 + 1)

      if (pageParam) {
        query = query.or(
          `and(created_at.lt.${pageParam.created_at}),and(created_at.eq.${pageParam.created_at},id.lt.${pageParam.id})`
        )
      }

      const { data: msgs, error } = await query

      if (error) throw error
      if (!msgs || msgs.length === 0) return { items: [], nextCursor: null }

      const hasMore = msgs.length > 50
      const items = hasMore ? msgs.slice(0, 50) : msgs
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore
        ? { created_at: lastItem.created_at, id: lastItem.id }
        : null

      // Batch-fetch sender profiles
      const senderIds = [...new Set(items.map((m) => m.sender_id))]
      const { data: senders } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', senderIds)

      const sendersMap = new Map((senders || []).map((s) => [s.id, s]))

      return {
        // Items are newest-first; we reverse for display (oldest first)
        items: [...items].reverse().map((m) => ({
          ...m,
          sender: sendersMap.get(m.sender_id),
        })) as Message[],
        nextCursor,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as { created_at: string; id: string } | null,
    enabled: !!conversationId,
    refetchOnMount: true,
    staleTime: 60_000,
  })
}

export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [mobileShowChat, setMobileShowChat] = useState(false)
  const [newMessage, setNewMessage] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const markMessageRead = useMarkMessageReadByConversation()

  const convsQuery = useConversations()
  const msgsQuery = useMessages(selectedConversationId)

  // Flatten pages into single arrays
  const conversations = convsQuery.data?.pages.flatMap((p) => p.items) ?? []
  const hasMoreConversations = convsQuery.hasNextPage
  const loadingConversations = convsQuery.isLoading

  const messages = msgsQuery.data?.pages.flatMap((p) => p.items) ?? []
  const hasMoreMessages = msgsQuery.hasNextPage
  const loadingMessages = msgsQuery.isLoading

  // Scroll refs for infinite scroll
  const convListRef = useRef<HTMLDivElement>(null)
  const msgListRef = useRef<HTMLDivElement>(null)

  // Load more conversations when scrolling to bottom
  const handleConvScroll = useCallback(() => {
    const el = convListRef.current
    if (!el || !hasMoreConversations || convsQuery.isFetchingNextPage) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      convsQuery.fetchNextPage()
    }
  }, [hasMoreConversations, convsQuery])

  // Load more messages when scrolling to top
  const handleMsgScroll = useCallback(() => {
    const el = msgListRef.current
    if (!el || !hasMoreMessages || msgsQuery.isFetchingNextPage) return
    if (el.scrollTop < 100) {
      msgsQuery.fetchNextPage()
    }
  }, [hasMoreMessages, msgsQuery])

  // Realtime: messages appear instantly in the active conversation
  useRealtimeMessages(selectedConversationId)
  // Realtime: conversations list reorders when new messages arrive
  useRealtimeConversations(session?.user?.id || null)

  // Open conversation from notification URL param
  useEffect(() => {
    const conversationParam = searchParams.get('conversation')
    if (conversationParam) {
      setSelectedConversationId(conversationParam)
      // Clean URL param after selecting
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Auto-mark message notification as read when opening a conversation
  useEffect(() => {
    if (selectedConversationId && session?.user?.id) {
      markMessageRead.mutate({
        userId: session.user.id,
        conversationId: selectedConversationId,
      })
    }
  }, [selectedConversationId, session?.user?.id])

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!session?.user?.id || !selectedConversationId) return

      const { error } = await supabase
        .from('messages')
        .insert({
          conversation_id: selectedConversationId,
          sender_id: session.user.id,
          content,
        })

      if (error) throw error

      // Actualizar last_message_at de la conversación
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', selectedConversationId)
    },
    onSuccess: () => {
      setNewMessage('')
      // Realtime hook adds the message to cache — no optimistic update needed
    },
  })

  const deleteConversation = useMutation({
    mutationFn: async (conversationId: string) => {
      // Delete messages first (in case FK doesn't cascade)
      await supabase.from('messages').delete().eq('conversation_id', conversationId)
      // Delete conversation
      const { error } = await supabase.from('conversations').delete().eq('id', conversationId)
      if (error) throw error
    },
    onSuccess: (_, conversationId) => {
      queryClient.setQueryData(['conversations'], (old: any) => {
        if (!old || !old.pages) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            items: page.items.filter((c: Conversation) => c.id !== conversationId),
          })),
        }
      })
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null)
        setMobileShowChat(false)
      }
      setDeleteTarget(null)
    },
  })

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (newMessage.trim()) {
      sendMessageMutation.mutate(newMessage.trim())
    }
  }

  const selectedConversation = conversations?.find((c) => c.id === selectedConversationId)

  if (!session) {
    return (
      <div className="bg-background text-on-background font-body-base text-body-base antialiased h-screen flex flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-secondary text-lg mb-4">Debes iniciar sesión para ver tus mensajes</p>
            <a href="/login" className="bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors">
              Iniciar Sesión
            </a>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-background text-on-background font-body-base text-body-base antialiased h-screen flex flex-col overflow-hidden">
      <Navbar />

      <main className="flex-1 flex w-full overflow-hidden">
        {/* Left Sidebar: Conversations List */}
        <aside className={`${mobileShowChat ? 'hidden' : 'flex'} md:flex w-full md:w-80 lg:w-96 flex-col bg-surface border-r border-border-light shrink-0`}>
          {/* Sidebar Header */}
          <div className="p-4 border-b border-border-light flex flex-col gap-3">
            <h2 className="font-header-md text-header-md text-on-surface">Mensajes</h2>
            <div className="flex items-center bg-surface-container-low rounded-full px-4 py-2 border border-transparent focus-within:border-primary-container focus-within:bg-surface transition-all">
              <span className="material-symbols-outlined text-text-muted mr-2 text-sm">search</span>
              <input
                className="bg-transparent border-none outline-none w-full text-on-surface font-body-base text-body-base p-0 focus:ring-0 text-sm"
                placeholder="Buscar en chats..."
                type="text"
              />
            </div>
          </div>

          {/* List of Chats */}
          <div
            ref={convListRef}
            onScroll={handleConvScroll}
            className="flex-1 overflow-y-auto"
          >
            {loadingConversations ? (
              <div className="flex items-center justify-center py-xxl">
                <div className="text-text-secondary">Cargando...</div>
              </div>
            ) : conversations && conversations.length > 0 ? (
              <>
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => {
                    setSelectedConversationId(conv.id)
                    setMobileShowChat(true)
                  }}
                  className={`group flex items-start gap-3 p-4 cursor-pointer relative border-l-4 transition-colors ${
                    selectedConversationId === conv.id
                      ? 'bg-bg-peach-soft border-primary-container'
                      : 'hover:bg-surface-container-low border-transparent'
                  }`}
                >
                  <div className="relative">
                    <Avatar
                      src={conv.other_user?.avatar_url}
                      name={conv.other_user?.full_name}
                      size={48}
                      className="shadow-sm"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-label-bold text-label-bold text-on-surface truncate">
                        {conv.other_user?.full_name || 'Usuario'}
                      </span>
                      <span className="font-small-subtext text-small-subtext text-text-secondary shrink-0">
                        {timeAgo(conv.last_message_at)}
                      </span>
                    </div>
                    {conv.last_message && (
                      <p className="font-body-base text-body-base text-on-surface-variant truncate text-sm">
                        {conv.last_message.content}
                      </p>
                    )}
                    {conv.listing && (
                      <div className="flex items-center gap-1 mt-1 text-primary-container">
                        <span className="material-symbols-outlined text-[14px]">inventory_2</span>
                        <span className="font-small-subtext text-small-subtext truncate">
                          {conv.listing.title}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget({ id: conv.id, name: conv.other_user?.full_name || 'esta conversación' })
                    }}
                    className="shrink-0 self-center p-2 rounded-full text-text-muted hover:text-error hover:bg-error-container transition-colors opacity-0 group-hover:opacity-100"
                    title="Eliminar conversación"
                  >
                    <span className="material-symbols-outlined text-[22px]">delete</span>
                  </button>
                </div>
              ))}
              {convsQuery.isFetchingNextPage && (
                <div className="flex items-center justify-center py-4">
                  <div className="text-text-muted text-sm">Cargando más chats...</div>
                </div>
              )}
            </>
            ) : (
              <div className="flex flex-col items-center justify-center py-xxl text-center">
                <span className="material-symbols-outlined text-6xl text-text-muted mb-4">chat_bubble_outline</span>
                <p className="text-text-secondary text-lg">No tenés mensajes aún</p>
                <p className="text-text-muted text-sm mt-2">
                  Cuando alguien te contacte, aparecerá acá
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Right Main Area: Active Chat */}
        <section className={`${mobileShowChat ? 'flex' : 'hidden'} md:flex flex-1 flex-col h-full bg-background relative`}>
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <header className="flex items-center justify-between p-4 bg-surface border-b border-border-light shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMobileShowChat(false)}
                    className="md:hidden p-1 -ml-1 text-text-secondary hover:text-primary-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                  </button>
                  <Avatar
                    src={selectedConversation.other_user?.avatar_url}
                    name={selectedConversation.other_user?.full_name}
                    size={40}
                  />
                  <div>
                    <h3 className="font-section-title text-section-title text-on-surface">
                      {selectedConversation.other_user?.full_name || 'Usuario'}
                    </h3>
                  </div>
                </div>

                {/* Product Context — clickable to listing */}
                {selectedConversation.listing && (
                  <Link
                    to={`/producto/${selectedConversation.listing.id}`}
                    className="flex items-center gap-3 bg-surface-container-low p-2 rounded-lg hover:bg-surface-container transition-colors"
                  >
                    <div className="flex flex-col items-end">
                      <span className="font-label-bold text-label-bold text-on-surface">
                        {selectedConversation.listing.title}
                      </span>
                      <span className="font-price-highlight text-price-highlight text-primary-container">
                        ${selectedConversation.listing.price?.toLocaleString('es-AR') || '0'}
                      </span>
                    </div>
                    <img
                      className="w-12 h-12 rounded object-cover border border-border-light"
                      src={selectedConversation.listing.images?.[0] || 'https://via.placeholder.com/48x48?text=Prod'}
                      alt={selectedConversation.listing.title}
                    />
                  </Link>
                )}
              </header>

              {/* Conversation Thread */}
              <div
                ref={msgListRef}
                onScroll={handleMsgScroll}
                className="flex-1 overflow-y-auto p-margin-desktop flex flex-col gap-4"
              >
                {loadingMessages ? (
                  <div className="flex items-center justify-center flex-1">
                    <div className="text-text-secondary">Cargando mensajes...</div>
                  </div>
                ) : messages && messages.length > 0 ? (
                  <>
                    {msgsQuery.isFetchingNextPage && (
                      <div className="flex items-center justify-center py-2">
                        <div className="text-text-muted text-sm">Cargando mensajes anteriores...</div>
                      </div>
                    )}
                    {messages.map((msg) => {
                      const isMe = msg.sender_id === session.user?.id
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isMe ? 'justify-end' : 'justify-start'} max-w-[75%] ${
                            isMe ? 'self-end' : ''
                          }`}
                        >
                          <div
                            className={`rounded-2xl p-3 shadow-sm flex flex-col gap-1 ${
                              isMe
                                ? 'bg-primary-container text-on-primary rounded-tr-sm'
                                : 'bg-surface border border-border-light rounded-tl-sm'
                            }`}
                          >
                            <p className="font-body-base text-body-base">{msg.content}</p>
                            <span
                              className={`font-small-subtext text-small-subtext self-end ${
                                isMe ? 'text-bg-peach-mid' : 'text-text-muted'
                              }`}
                            >
                              {timeAgo(msg.created_at)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </>
                ) : (
                  <div className="flex items-center justify-center flex-1">
                    <div className="text-text-secondary">No hay mensajes aún</div>
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div className="p-4 bg-surface border-t border-border-light shrink-0">
                <form onSubmit={handleSendMessage} className="flex items-end gap-2 bg-surface-container-low rounded-2xl p-2 border border-transparent focus-within:border-primary-container focus-within:bg-surface transition-all">
                  <button type="button" className="p-2 text-text-secondary hover:text-primary-container transition-colors rounded-full shrink-0">
                    <span className="material-symbols-outlined">attach_file</span>
                  </button>
                  <button type="button" className="p-2 text-text-secondary hover:text-primary-container transition-colors rounded-full shrink-0">
                    <span className="material-symbols-outlined">image</span>
                  </button>
                  <textarea
                    className="flex-1 bg-transparent border-none outline-none resize-none max-h-32 text-on-surface font-body-base text-body-base py-2 px-2 focus:ring-0"
                    placeholder="Escribí un mensaje..."
                    rows={1}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    style={{ minHeight: '40px' }}
                  ></textarea>
                  <button
                    type="submit"
                    disabled={!newMessage.trim() || sendMessageMutation.isPending}
                    className="p-3 bg-primary-container text-on-primary rounded-full hover:opacity-90 transition-opacity shrink-0 flex items-center justify-center shadow-sm h-10 w-10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined">send</span>
                  </button>
                </form>
                <div className="text-center mt-2">
                  <span className="font-small-subtext text-small-subtext text-text-muted flex items-center justify-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">lock</span>
                    Mensajes protegidos por Umpi Marketplace
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-text-secondary">
                <span className="material-symbols-outlined text-6xl text-text-muted mb-4">chat_bubble_outline</span>
                <p className="text-lg">Seleccioná una conversación</p>
              </div>
            </div>
          )}
        </section>
      </main>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteConversation.mutate(deleteTarget.id)
          }
        }}
        title="Eliminar conversación"
        message={`¿Estás seguro que quieres eliminar la conversación con ${deleteTarget?.name}? Se borrarán todos los mensajes.`}
        confirmLabel="Eliminar"
        danger
        loading={deleteConversation.isPending}
      />
    </div>
  )
}
