import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, User, Utensils, Dumbbell, Droplets, Weight,
  Apple, ShoppingCart, TrendingUp, ChevronLeft, ChevronRight,
  ClipboardList, Menu, X, Settings, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/meals', label: 'Meal Tracker', icon: Utensils },
  { path: '/workouts', label: 'Workout Tracker', icon: Dumbbell },
  { path: '/water', label: 'Water Tracker', icon: Droplets },
  { path: '/weight', label: 'Weight Tracker', icon: Weight },
  { path: '/meal-planner', label: 'Meal Planner', icon: Apple },
  { path: '/workout-planner', label: 'Workout Planner', icon: ClipboardList },
  { path: '/grocery', label: 'Grocery List', icon: ShoppingCart },
  { path: '/insights', label: 'Progress Insights', icon: TrendingUp },
  { path: '/history', label: 'History', icon: History },
  { path: '/profile', label: 'Profile', icon: User },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shrink-0">
          <Dumbbell className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <span className="font-heading font-bold text-lg whitespace-nowrap">
            Healthy Fit
          </span>
        )}
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group
                ${isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-primary' : ''}`} />
              {!collapsed && <span className="text-sm whitespace-nowrap">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 hidden md:block">
        <button
          onClick={() => setCollapsed(prev => !prev)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors text-sm"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg glass"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/50 z-50"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25 }}
              className="md:hidden fixed left-0 top-0 bottom-0 w-[260px] bg-card border-r border-border z-50"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 p-1 rounded-lg hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
              <NavContent />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <div
        className={`hidden md:block fixed left-0 top-0 bottom-0 bg-card border-r border-border z-40 transition-all duration-300 ${
          collapsed ? 'w-[70px]' : 'w-[240px]'
        }`}
      >
        <NavContent />
      </div>
    </>
  );
}

export function useSidebarWidth() {
  return { desktop: 240, collapsed: 70 };
}
