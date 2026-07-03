import React from 'react';
import { motion } from 'framer-motion';

export default function GlassCard({ children, className = '', animate = true, ...rest }) {
  const Wrapper = animate ? motion.div : 'div';
  const props = animate ? {
    initial: { opacity: 0, y: 10 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-40px' },
    whileHover: { y: -2 },
    transition: { duration: 0.25, ease: 'easeOut' },
  } : {};

  return (
    <Wrapper
      {...props}
      {...rest}
      className={`rounded-2xl bg-card/76 border border-white/10 shadow-xl shadow-black/10 backdrop-blur-2xl p-5 transition-colors ${className}`}
    >
      {children}
    </Wrapper>
  );
}
