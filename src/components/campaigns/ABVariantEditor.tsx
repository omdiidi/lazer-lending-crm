import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FlaskConical, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MERGE_FIELDS } from '@/lib/merge-fields';

interface ABVariantEditorProps {
  subject: string;
  body: string;
  onSubjectChange: (s: string) => void;
  onBodyChange: (b: string) => void;
}

export default function ABVariantEditor({ subject, body, onSubjectChange, onBodyChange }: ABVariantEditorProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const insertField = (tag: string) => {
    const textarea = bodyRef.current
    if (!textarea) { onBodyChange(body + tag); return }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newValue = body.slice(0, start) + tag + body.slice(end)
    onBodyChange(newValue)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  return (
    <Card className="border border-dashed border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" /> Variant B
          <span className="text-xs text-muted-foreground font-normal ml-auto">50% of recipients will receive this version</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input placeholder="Variant B subject line..." value={subject} onChange={e => onSubjectChange(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Body</Label>
          <div className="flex items-center gap-0.5 px-2 py-1.5 border rounded-t-md bg-muted/30 border-b-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onMouseDown={e => e.preventDefault()}>
                  Add Field <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {MERGE_FIELDS.map(field => (
                  <DropdownMenuItem key={field.tag} onSelect={() => insertField(field.tag)}>
                    {field.label} <span className="ml-auto text-xs text-muted-foreground pl-4">{field.tag}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Textarea ref={bodyRef} placeholder="Variant B email body... Use {{firstName}} and {{company}}" value={body} onChange={e => onBodyChange(e.target.value)} className="min-h-[150px] rounded-t-none" />
        </div>
      </CardContent>
    </Card>
  );
}
