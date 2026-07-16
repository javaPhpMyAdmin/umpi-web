import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import type { Conversation, Message } from '../../../types'
import Navbar from '../../../components/layout/Navbar'
import { useAuth } from '../../../hooks/useAuth'
import { timeAgo } from '../../../lib/utils'

function useConversations() {
  const { session } = useAuth()

  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      if (!session?.user?.id) return []

      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          listing:listing_id(*),
          other_user:user2_id!conversations_user2_id_fkey(*),
          last_message:messages!conversations_last_message_at_fkey(*)
        `)
        .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
        .order('last_message_at', { ascending: false })

      if (error) throw error
      return data as Conversation[]
    },
    enabled: !!session?.user?.id,
  })
}

function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return []

      const { data, error } = await supabase
        .from('messages')
        .select('*, sender:sender_id(*)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      return data as Message[]
    },
    enabled: !!conversationId,
  })
}

export default function MessagesPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const queryClient = useQueryClient()
  const { session } = useAuth()

  const { data: conversations, isLoading: loadingConversations } = useConversations()
  const { data: messages, isLoading: loadingMessages } = useMessages(selectedConversationId)

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
      queryClient.invalidateQueries({ queryKey: ['messages'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setNewMessage('')
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
        <aside className="w-full md:w-80 lg:w-96 flex flex-col bg-surface border-r border-border-light shrink-0">
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
          <div className="flex-1 overflow-y-auto">
            {loadingConversations ? (
              <div className="flex items-center justify-center py-xxl">
                <div className="text-text-secondary">Cargando...</div>
              </div>
            ) : conversations && conversations.length > 0 ? (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConversationId(conv.id)}
                  className={`flex items-start gap-3 p-4 cursor-pointer relative border-l-4 transition-colors ${
                    selectedConversationId === conv.id
                      ? 'bg-bg-peach-soft border-primary-container'
                      : 'hover:bg-surface-container-low border-transparent'
                  }`}
                >
                  <div className="relative">
                    <img
                      className="w-12 h-12 rounded-full object-cover shadow-sm"
                      src={conv.other_user?.avatar_url || 'https://via.placeholder.com/48x48?text=User'}
                      alt={conv.other_user?.full_name || 'Usuario'}
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
                </div>
              ))
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
        <section className="hidden md:flex flex-1 flex-col h-full bg-background relative">
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <header className="flex items-center justify-between p-4 bg-surface border-b border-border-light shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-3">
                  <img
                    className="w-10 h-10 rounded-full object-cover"
                    src={selectedConversation.other_user?.avatar_url || 'https://via.placeholder.com/40x40?text=User'}
                    alt={selectedConversation.other_user?.full_name || 'Usuario'}
                  />
                  <div>
                    <h3 className="font-section-title text-section-title text-on-surface">
                      {selectedConversation.other_user?.full_name || 'Usuario'}
                    </h3>
                  </div>
                </div>

                {/* Product Context */}
                {selectedConversation.listing && (
                  <div className="flex items-center gap-3 bg-surface-container-low p-2 rounded-lg">
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
                  </div>
                )}
              </header>

              {/* Conversation Thread */}
              <div className="flex-1 overflow-y-auto p-margin-desktop flex flex-col gap-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center flex-1">
                    <div className="text-text-secondary">Cargando mensajes...</div>
                  </div>
                ) : messages && messages.length > 0 ? (
                  messages.map((msg) => {
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
                  })
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
    </div>
  )
}
