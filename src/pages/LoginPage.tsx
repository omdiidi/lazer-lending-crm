import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { signupWithToken } from '@/lib/api/team';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Signup state
  const [inviteToken, setInviteToken] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const success = await login(email, password);
      if (!success) setError('Invalid email or password');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');
    setSignupLoading(true);
    try {
      const result = await signupWithToken(inviteToken, signupPassword);
      // Auto-login with the new credentials
      const success = await login(result.email, signupPassword);
      if (!success) {
        setSignupSuccess(true);
        setSignupError('Account created! Please log in with your email.');
      }
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setSignupLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="mx-auto flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">I</span>
            </div>
            <span className="text-xl font-semibold tracking-tight text-foreground">IntegrateAPI</span>
          </div>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your CRM account</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button variant={mode === 'login' ? 'default' : 'outline'} size="sm" onClick={() => setMode('login')} className="flex-1">
              Sign In
            </Button>
            <Button variant={mode === 'signup' ? 'default' : 'outline'} size="sm" onClick={() => setMode('signup')} className="flex-1">
              Sign Up
            </Button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@integrateapi.ai" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token">Invite Token</Label>
                <Input id="token" placeholder="Paste your invite token" value={inviteToken} onChange={e => setInviteToken(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input id="signup-password" type="password" placeholder="Choose a password (min 8 chars)" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} />
              </div>
              {signupError && <p className="text-sm text-destructive">{signupError}</p>}
              {signupSuccess && !signupError && <p className="text-sm text-green-600">Account created! Please sign in.</p>}
              <Button type="submit" className="w-full" disabled={signupLoading || !inviteToken.trim() || signupPassword.length < 8}>
                {signupLoading ? 'Creating account...' : 'Create Account'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
