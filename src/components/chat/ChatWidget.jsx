import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { useProfile } from '@/lib/useProfile';
import { generateAIResponse } from '@/services/aiFeatures';
import { dataService } from '@/services/dataService';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const scrollRef = useRef(null);
  const messagesRef = useRef([]);
  const activeRequestRef = useRef(null);
  const recordIdRef = useRef(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  const { profile } = useProfile();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await dataService.entities.ChatMessage.filter({ date: today }, '-created_date', 1);
        if (cancelled) return;

        const existing = rows?.[0];
        if (existing) {
          recordIdRef.current = existing.id;
          const savedMessages = existing.plan_data?.messages || [];
          setMessages(savedMessages);
          messagesRef.current = savedMessages;
        }
      } catch (error) {
        console.error('Could not load chat history:', error);
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [today]);

  const persistConversation = useCallback(async (allMessages) => {
    try {
      const payload = { plan_data: { messages: allMessages }, date: today };
      if (recordIdRef.current) {
        await dataService.entities.ChatMessage.update(recordIdRef.current, payload);
      } else {
        const created = await dataService.entities.ChatMessage.create(payload);
        recordIdRef.current = created.id;
      }
    } catch (error) {
      console.error('Could not save chat history:', error);
    }
  }, [today]);

  // Auto scroll
  useEffect(() => {
    messagesRef.current = messages;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const requestId = `${Date.now()}-${Math.random()}`;
    activeRequestRef.current = requestId;
    setLoading(true);

    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messagesRef.current, userMsg];

    setMessages(nextMessages);
    messagesRef.current = nextMessages;
    setInput('');

    const profileContext = profile
      ? `User Profile:
Name: ${profile.name}
Age: ${profile.age}
Gender: ${profile.gender}
Height: ${profile.height}cm
Weight: ${profile.weight}kg
Goal: ${profile.fitness_goal}
Diet: ${profile.diet_preference}
Allergies: ${profile.food_allergies?.join(', ') || 'none'}
Water goal: ${profile.water_goal_litres}L`
      : '';

    const chatHistory = nextMessages
      .slice(-8)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `
You are Healthy Fit AI, a fitness and nutrition assistant.

${profileContext}

Recent conversation:
${chatHistory}

User: ${text}

Rules:
- Be helpful and concise
- Use profile if relevant
- Give actionable answers
`;

    try {
      const response = await generateAIResponse(prompt);
      if (activeRequestRef.current !== requestId) return;

      const withReply = [...nextMessages, { role: 'assistant', content: response }];
      setMessages(withReply);
      messagesRef.current = withReply;
      persistConversation(withReply);

    } catch (err) {
      console.error(err);

      const withError = [
        ...nextMessages,
        {
          role: 'assistant',
          content: "I'm having trouble responding right now. Please try again."
        },
      ];
      setMessages(withError);
      messagesRef.current = withError;
      persistConversation(withError);
    } finally {
      if (activeRequestRef.current === requestId) {
        activeRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [input, loading, profile, persistConversation]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 right-4 w-[360px] h-[500px] bg-card border rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b gradient-primary text-white">
              <span className="font-semibold flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Healthy Fit AI
              </span>
              <button onClick={() => setOpen(false)}>
                <X />
              </button>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              <div className="space-y-3">

                {historyLoaded && messages.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm">
                    Ask me anything about fitness or nutrition.
                  </p>
                )}

                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-white'
                        : 'bg-muted'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted px-3 py-2 rounded-xl">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  </div>
                )}

              </div>
            </ScrollArea>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="p-3 border-t flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything..."
              />

              <Button type="submit" disabled={loading || !input.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-4 right-4 flex h-14 w-14 items-center justify-center rounded-full gradient-primary text-white shadow-lg"
        aria-label={open ? 'Close Healthy Fit AI chat' : 'Open Healthy Fit AI chat'}
      >
        {open ? <X /> : <Bot className="h-7 w-7" />}
      </button>
    </>
  );
}
