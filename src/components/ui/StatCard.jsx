import React from 'react';
import { motion } from 'framer-motion';

export default function StatCard({ title, value, unit, icon: Icon, color = 'emerald', subtitle }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl bg-card border border-border/50 shadow-sm p-5 relative overflow-hidden`}
    >
      <div className={`absolute top-0 right-0 w-20 h-20 bg-${color}-500/10 rounded-full -translate-y-6 translate-x-6`} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold font-heading mt-1">
            {value}
            {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
          </p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl bg-${color}-500/10`}>
            <Icon className={`w-5 h-5 text-${color}-500`} />
          </div>
        )}
      </div>
    </motion.div>
  );
}