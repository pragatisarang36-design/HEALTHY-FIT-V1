import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ChatWidget from '@/components/chat/ChatWidget';

export default function AppLayout() {
  const [cursor, setCursor] = useState({ x: -999, y: -999 });
  const location = useLocation();

  return (
    <div className="min-h-screen bg-transparent" onMouseMove={(event) => setCursor({ x: event.clientX, y: event.clientY })}>
      <div className="app-bg" />
      <div className="cursor-glow hidden md:block" style={{ left: cursor.x, top: cursor.y }} />
      <Sidebar />
      <div className="md:ml-[240px] flex flex-col min-h-screen">
        <TopBar />
        <main className="flex-1 p-4 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ChatWidget />
    </div>
  );
}
