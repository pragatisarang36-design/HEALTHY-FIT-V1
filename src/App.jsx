import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';

import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Profile from '@/pages/Profile';
import MealTracker from '@/pages/MealTracker';
import WorkoutTracker from '@/pages/WorkoutTracker';
import WaterTracker from '@/pages/WaterTracker';
import WeightTracker from '@/pages/WeightTracker';
import MealPlanner from '@/pages/MealPlanner';
import WorkoutPlanner from '@/pages/WorkoutPlanner';
import GroceryList from '@/pages/GroceryList';
import ProgressInsights from '@/pages/ProgressInsights';
import Settings from '@/pages/Settings';
import History from '@/pages/History';
import Login from '@/pages/Login';
import DataQualityDashboard from '@/pages/DataQualityDashboard';

const AuthSpinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

function GuestRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <AuthSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute>
            <Login />
          </GuestRoute>
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/meals" element={<MealTracker />} />
          <Route path="/workouts" element={<WorkoutTracker />} />
          <Route path="/water" element={<WaterTracker />} />
          <Route path="/weight" element={<WeightTracker />} />
          <Route path="/meal-planner" element={<MealPlanner />} />
          <Route path="/workout-planner" element={<WorkoutPlanner />} />
          <Route path="/grocery" element={<GroceryList />} />
          <Route path="/insights" element={<ProgressInsights />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/data-quality" element={<DataQualityDashboard />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AppRoutes />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
