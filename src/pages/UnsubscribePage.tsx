import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';

export default function UnsubscribePage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'error'>('loading');

  useEffect(() => {
    if (!token || !email) {
      setStatus('error');
      return;
    }

    supabase.functions.invoke('unsubscribe', {
      body: { token, email },
    }).then(({ data, error }) => {
      if (error) { setStatus('error'); return; }
      if (data?.already) { setStatus('already'); return; }
      if (data?.success) { setStatus('success'); return; }
      setStatus('error');
    });
  }, [token, email]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          {status === 'loading' && (
            <>
              <h1 className="text-xl font-semibold">Processing...</h1>
              <p className="text-muted-foreground">Please wait while we update your preferences.</p>
            </>
          )}
          {status === 'success' && (
            <>
              <h1 className="text-xl font-semibold text-foreground">You've been unsubscribed</h1>
              <p className="text-muted-foreground">You will no longer receive campaign emails from us. We're sorry to see you go.</p>
            </>
          )}
          {status === 'already' && (
            <>
              <h1 className="text-xl font-semibold text-foreground">Already unsubscribed</h1>
              <p className="text-muted-foreground">You were already unsubscribed from our campaign emails.</p>
            </>
          )}
          {status === 'error' && (
            <>
              <h1 className="text-xl font-semibold text-destructive">Something went wrong</h1>
              <p className="text-muted-foreground">We couldn't process your unsubscribe request. Please try again or contact support.</p>
            </>
          )}
          <p className="text-xs text-muted-foreground pt-4">IntegrateAPI</p>
        </CardContent>
      </Card>
    </div>
  );
}
