import { useTemplates } from '@/hooks/use-templates';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Trash2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { CampaignTemplate } from '@/types/crm';

interface TemplateLibraryProps {
  onSelect: (template: CampaignTemplate) => void;
}

export default function TemplateLibrary({ onSelect }: TemplateLibraryProps) {
  const { templates, isLoading, deleteTemplate } = useTemplates();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await deleteTemplate(id); toast.success('Template deleted'); }
    catch { toast.error('Failed to delete template'); }
  };

  if (isLoading) return <p className="text-xs text-muted-foreground py-4 text-center">Loading templates...</p>;

  if (templates.length === 0) {
    return (
      <div className="text-center py-6">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No saved templates</p>
        <p className="text-xs text-muted-foreground">Create a template and save it for reuse.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[250px] overflow-y-auto">
      {templates.map(t => (
        <Card key={t.id} className="border cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => onSelect(t)}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{t.name}</p>
              <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={e => handleDelete(t.id, e)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
