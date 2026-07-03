import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Dumbbell, Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import GlassCard from '@/components/ui/GlassCard';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';

const AuthSpinner = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

export default function Login() {
  const { isAuthenticated, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <AuthSpinner />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSignIn = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      console.log("LOGIN PAGE: Attempting sign in with", normalizedEmail);
      const { error } = await signIn({ email: normalizedEmail, password });
      if (error) {
        console.log("LOGIN PAGE: Sign in failed", error);
        toast({ title: error.message, variant: 'destructive' });
        return;
      }
      console.log("LOGIN PAGE: Sign in successful, navigating to dashboard");
      navigate('/', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      console.log("LOGIN PAGE: Attempting sign up with", normalizedEmail);
      const { error, needsEmailConfirmation } = await signUp({ email: normalizedEmail, password });
      if (error) {
        console.log("LOGIN PAGE: Sign up failed", error);
        toast({ title: error.message, variant: 'destructive' });
        return;
      }

      console.log("LOGIN PAGE: Sign up successful, needsEmailConfirmation:", needsEmailConfirmation);
      toast({
        title: 'Account created',
        description: 'Please check your email to verify your account before logging in.',
      });

      console.log("LOGIN PAGE: Navigating to login page");
      navigate('/login', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = mode === 'signup' ? handleSignUp : handleSignIn;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4">
            <Dumbbell className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-heading font-bold">Healthy Fit</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {mode === 'signup' ? 'Create an account to start tracking.' : 'Sign in to continue tracking your fitness.'}
          </p>
        </div>

        <GlassCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
                minLength={6}
              />
            </div>
            <Button
              type="submit"
              disabled={submitting}
              className="w-full gradient-primary text-white"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : mode === 'signup' ? (
                <UserPlus className="w-4 h-4 mr-2" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              {mode === 'signup' ? 'Create Account' : 'Login'}
            </Button>
          </form>
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="w-full text-sm text-primary hover:underline mt-4"
          >
            {mode === 'login' ? 'Create a new account' : 'Already have an account? Login'}
          </button>
        </GlassCard>
      </div>
    </div>
  );
}
