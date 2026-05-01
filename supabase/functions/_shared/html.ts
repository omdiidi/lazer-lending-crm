export function plainTextToHtml(text: string): string {
  // 1. Escape HTML special chars FIRST
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // 2. Auto-link bare URLs — use [^\s<>"] (NOT [^\s<>"&]) so multi-param
  //    query strings like ?a=1&amp;b=2 aren't truncated after escaping
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1">$1</a>'
  )

  // 3. Split on double newlines → paragraphs; single newlines → <br>
  const paragraphs = linked
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map(p => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')

  // 4. Minimal HTML wrapper — looks like a real email, not a webpage
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#222;max-width:600px;margin:0 auto;padding:20px 0;">
${paragraphs}
</body>
</html>`
}
