import { useEffect, useRef } from 'react';

interface EmailBodyProps {
  body: string;
  title?: string;
}

const HTML_START = /^\s*(<!doctype|<html)/i;

export function EmailBody({ body, title }: EmailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isHtml = HTML_START.test(body);

  useEffect(() => {
    if (!isHtml) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let ro: ResizeObserver | null = null;

    const syncHeight = () => {
      const h = iframe.contentDocument?.body?.scrollHeight;
      if (h) iframe.style.height = `${h + 20}px`;
    };

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      if (!doc.getElementById('__email-body-reset')) {
        const style = doc.createElement('style');
        style.id = '__email-body-reset';
        style.textContent = `
          html, body { margin: 0; padding: 0; overflow-wrap: anywhere; word-wrap: break-word; }
          img, video, iframe, table { max-width: 100% !important; height: auto; }
          pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
          a { overflow-wrap: anywhere; word-break: break-all; }
        `;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      syncHeight();
      ro?.disconnect();
      ro = new ResizeObserver(syncHeight);
      ro.observe(doc.body);
    };

    iframe.addEventListener('load', handleLoad);
    if (iframe.contentDocument?.readyState === 'complete' && iframe.contentDocument.body) {
      handleLoad();
    }

    return () => {
      ro?.disconnect();
      iframe.removeEventListener('load', handleLoad);
    };
  }, [body, isHtml]);

  if (!body?.trim()) {
    return <p className="text-sm italic text-muted-foreground">No content</p>;
  }

  if (isHtml) {
    return (
      <iframe
        ref={iframeRef}
        srcDoc={body}
        sandbox="allow-same-origin"
        title={title ?? 'Email content'}
        className="w-full border-none"
        style={{ minHeight: '100px' }}
      />
    );
  }

  return (
    <p className="text-sm whitespace-pre-line leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {body}
    </p>
  );
}
