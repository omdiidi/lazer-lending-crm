/**
 * LeadImportDialog — CSV import for leads (Lazer's primary lead-input path).
 *
 * Flow:
 *   1. select     — pick a .csv file
 *   2. map        — confirm/adjust column → field mapping (email required), preview
 *   3. importing  — bulk-insert leads via useLeads().addLeads
 *   4. validating — ZeroBounce bulk validation (submit → poll → finalize).
 *                   This stamps validation data onto the just-imported leads and
 *                   suppresses bad addresses. Degrades gracefully if ZeroBounce
 *                   is not configured — leads are still imported.
 *   5. done       — summary stats
 */

import { useState } from 'react';
import { useLeads } from '@/hooks/use-leads';
import {
  parseCsv,
  autoDetectColumns,
  utf8ToBase64,
  parseNumeric,
  type LeadField,
  type ParsedCsv,
} from '@/lib/csv';
import { Checkbox } from '@/components/ui/checkbox';
import {
  submitValidation,
  pollThenFinalize,
  ValidateUploadError,
  type FinalizeResult,
} from '@/lib/api/validate-upload';
import type { Lead } from '@/types/crm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

type Phase = 'select' | 'map' | 'importing' | 'validating' | 'done';

const FIELD_LABELS: Record<LeadField, string> = {
  email: 'Email (required)',
  firstName: 'First Name',
  lastName: 'Last Name',
  company: 'Company',
  jobTitle: 'Job Title',
  phone: 'Phone',
  industry: 'Industry',
  location: 'Location',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  estimatedHomeValue: 'Est. Home Value',
  mortgageBalance: 'Mortgage Balance',
  ltv: 'LTV',
  creditGrade: 'Credit Grade',
  propertyType: 'Property Type',
  loanType: 'Loan Type',
  interestRate: 'Interest Rate',
  cashOut: 'Cash Out',
  vaStatus: 'VA Status',
  vaLoan: 'VA Loan',
  fhaLoan: 'FHA Loan',
  product: 'Product',
  ipAddress: 'IP Address',
  sourceTimestamp: 'Source Timestamp',
  externalLeadId: 'Lead ID',
};

const FIELD_ORDER: LeadField[] = [
  'email', 'firstName', 'lastName', 'phone', 'address', 'city', 'state', 'zip',
  'estimatedHomeValue', 'mortgageBalance', 'ltv', 'creditGrade', 'propertyType',
  'loanType', 'interestRate', 'cashOut', 'vaStatus', 'vaLoan', 'fhaLoan',
  'product', 'ipAddress', 'sourceTimestamp', 'externalLeadId',
  'company', 'jobTitle', 'industry', 'location',
];

const NONE_VALUE = '__none__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LeadImportDialog({ open, onOpenChange }: Props) {
  const { addLeads } = useLeads();

  const [phase, setPhase] = useState<Phase>('select');
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<LeadField, number>>({} as Record<LeadField, number>);

  const [importedCount, setImportedCount] = useState(0);
  const [progress, setProgress] = useState<string | number | undefined>(undefined);
  const [validation, setValidation] = useState<FinalizeResult | null>(null);
  const [validationSkipped, setValidationSkipped] = useState<string | null>(null);
  // Default ON: most lists we import are pre-validated (e.g. a ZeroBounce-filtered
  // export), so mark verified + skip re-validation to avoid spending credits again.
  const [markVerified, setMarkVerified] = useState(true);

  function resetAndClose() {
    setPhase('select');
    setFileName('');
    setRawText('');
    setParsed(null);
    setMapping({} as Record<LeadField, number>);
    setImportedCount(0);
    setProgress(undefined);
    setValidation(null);
    setValidationSkipped(null);
    setMarkVerified(true);
    onOpenChange(false);
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const result = parseCsv(text);
      if (result.rows.length === 0) {
        toast.error('No data rows found in CSV.');
        return;
      }
      setFileName(file.name);
      setRawText(text);
      setParsed(result);
      setMapping(autoDetectColumns(result.headers));
      setPhase('map');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse CSV.');
    }
  }

  /** Build deduped lead objects from the mapped columns. */
  function buildLeads(): Omit<Lead, 'id' | 'createdAt'>[] {
    if (!parsed) return [];
    const emailIdx = mapping.email;
    const seen = new Set<string>();
    const leads: Omit<Lead, 'id' | 'createdAt'>[] = [];

    for (const row of parsed.rows) {
      const email = (row[emailIdx] ?? '').trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const get = (field: LeadField) => {
        const idx = mapping[field];
        return idx !== undefined && idx >= 0 ? (row[idx] ?? '').trim() : '';
      };
      const num = (field: LeadField) => parseNumeric(get(field)) ?? null;

      leads.push({
        firstName: get('firstName'),
        lastName: get('lastName'),
        email,
        company: get('company'),
        jobTitle: get('jobTitle'),
        phone: get('phone'),
        industry: get('industry'),
        location: get('location'),
        status: 'cold',
        // Pre-validated import → mark sendable immediately.
        ...(markVerified ? { emailStatus: 'verified' } : {}),
        // Mortgage/property fields
        address: get('address'),
        city: get('city'),
        state: get('state'),
        zip: get('zip'),
        estimatedHomeValue: num('estimatedHomeValue'),
        mortgageBalance: num('mortgageBalance'),
        ltv: num('ltv'),
        creditGrade: get('creditGrade'),
        propertyType: get('propertyType'),
        loanType: get('loanType'),
        interestRate: num('interestRate'),
        cashOut: get('cashOut'),
        vaStatus: get('vaStatus'),
        vaLoan: get('vaLoan'),
        fhaLoan: get('fhaLoan'),
        product: get('product'),
        ipAddress: get('ipAddress'),
        sourceTimestamp: get('sourceTimestamp'),
        externalLeadId: get('externalLeadId'),
      } as unknown as Omit<Lead, 'id' | 'createdAt'>);
    }
    return leads;
  }

  async function handleImport() {
    const leads = buildLeads();
    if (leads.length === 0) {
      toast.error('No rows with a valid email to import.');
      return;
    }

    // Phase 1: import leads
    setPhase('importing');
    try {
      await addLeads(leads);
      setImportedCount(leads.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lead import failed.');
      setPhase('map');
      return;
    }

    // Pre-validated list: skip ZeroBounce entirely (leads were marked verified).
    if (markVerified) {
      setPhase('done');
      return;
    }

    // Phase 2: kick off ZeroBounce validation (best-effort, non-blocking for import)
    setPhase('validating');
    try {
      const submit = await submitValidation(utf8ToBase64(rawText), mapping.email);
      const result = await pollThenFinalize(submit.file_id, {
        onProgress: setProgress,
      });
      setValidation(result);
    } catch (err) {
      // Graceful degradation: leads are already imported. Surface why validation
      // didn't run (most commonly: ZEROBOUNCE_API_KEY not configured yet — B12).
      const msg = err instanceof ValidateUploadError
        ? err.message
        : err instanceof Error ? err.message : 'Validation unavailable.';
      setValidationSkipped(msg);
    }
    setPhase('done');
  }

  const emailMapped = mapping.email !== undefined && mapping.email >= 0;
  const previewRows = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV, map the columns, and import. Email addresses are validated
            via ZeroBounce after import.
          </DialogDescription>
        </DialogHeader>

        {/* ---- Phase: select ---- */}
        {phase === 'select' && (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-muted-foreground/30 rounded-lg py-12 cursor-pointer hover:bg-accent/40 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Click to choose a <code>.csv</code> file
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        )}

        {/* ---- Phase: map ---- */}
        {phase === 'map' && parsed && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="font-medium text-foreground">{fileName}</span>
              <span>· {parsed.rows.length} rows</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {FIELD_ORDER.map((field) => (
                <div key={field} className="space-y-1">
                  <Label className="text-xs">{FIELD_LABELS[field]}</Label>
                  <Select
                    value={mapping[field] >= 0 ? String(mapping[field]) : NONE_VALUE}
                    onValueChange={(v) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field]: v === NONE_VALUE ? -1 : parseInt(v, 10),
                      }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>—</SelectItem>
                      {parsed.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-t">
                      {parsed.headers.map((_, ci) => (
                        <td key={ci} className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {row[ci] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
              <Checkbox
                id="mark-verified"
                checked={markVerified}
                onCheckedChange={(v) => setMarkVerified(v === true)}
                className="mt-0.5"
              />
              <label htmlFor="mark-verified" className="text-sm cursor-pointer">
                <span className="font-medium">These emails are already validated</span>
                <span className="block text-xs text-muted-foreground">
                  Mark leads as verified (sendable) and skip ZeroBounce — no credits used.
                  Uncheck only if this list has not been validated yet.
                </span>
              </label>
            </div>
            {!emailMapped && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Map the Email column to continue.
              </p>
            )}
          </div>
        )}

        {/* ---- Phase: importing / validating ---- */}
        {(phase === 'importing' || phase === 'validating') && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {phase === 'importing'
                ? 'Importing leads…'
                : `Validating emails via ZeroBounce${
                    progress !== undefined ? ` · ${progress}%` : '…'
                  }`}
            </p>
          </div>
        )}

        {/* ---- Phase: done ---- */}
        {phase === 'done' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">{importedCount} leads imported</span>
            </div>

            {validation && (
              <div className="space-y-2 text-sm">
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    {validation.valid} valid
                  </Badge>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    {validation.suppressed} suppressed
                  </Badge>
                  <Badge variant="outline" className="bg-slate-50 text-slate-600">
                    {validation.total} checked
                  </Badge>
                </div>
                {Object.keys(validation.by_substatus).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {Object.entries(validation.by_substatus)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}

            {validationSkipped && (
              <p className="text-xs text-amber-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Email validation didn’t run: {validationSkipped}</span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {phase === 'map' && (
            <>
              <Button variant="outline" onClick={() => setPhase('select')}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={!emailMapped}>
                Import leads
              </Button>
            </>
          )}
          {(phase === 'select' || phase === 'importing' || phase === 'validating') && (
            <Button variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
          )}
          {phase === 'done' && <Button onClick={resetAndClose}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
