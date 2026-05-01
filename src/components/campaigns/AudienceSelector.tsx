import { useState, useMemo, useRef, useEffect } from 'react';
import type { Lead } from '@/types/crm';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Users, Phone, Mail } from 'lucide-react';

interface AudienceSelectorProps {
  leads: Lead[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  unsubscribedEmails?: Set<string>;
}

const COUNT_OPTIONS = ['0', '1', '2', '3', '4', '5+'] as const;

export default function AudienceSelector({
  leads,
  selectedIds,
  onSelectionChange,
  unsubscribedEmails = new Set(),
}: AudienceSelectorProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [callCountFilter, setCallCountFilter] = useState<Set<string>>(new Set());
  const [emailCountFilter, setEmailCountFilter] = useState<Set<string>>(new Set());

  const prevCallFilter = useRef(callCountFilter);
  const prevEmailFilter = useRef(emailCountFilter);

  const industries = useMemo(() =>
    [...new Set(leads.map(l => l.industry).filter(Boolean))].sort(),
    [leads]
  );

  const toggleCountFilter = (value: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const matchesCountFilter = (count: number, filter: Set<string>) => {
    if (filter.size === 0) return true;
    const bucket = count >= 5 ? '5+' : String(count);
    return filter.has(bucket);
  };

  const filtered = useMemo(() => {
    return leads.filter(l => {
      if (unsubscribedEmails.has(l.email)) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (industryFilter !== 'all' && l.industry !== industryFilter) return false;
      if (callCountFilter.size > 0 && !matchesCountFilter(l.callCount ?? 0, callCountFilter)) return false;
      if (emailCountFilter.size > 0 && !matchesCountFilter(l.emailCount ?? 0, emailCountFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return l.firstName.toLowerCase().includes(q) || l.lastName.toLowerCase().includes(q)
          || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q);
      }
      return true;
    });
  }, [leads, statusFilter, industryFilter, search, unsubscribedEmails, callCountFilter, emailCountFilter]);

  // Auto-select all filtered leads when count filters change
  useEffect(() => {
    const callChanged = callCountFilter !== prevCallFilter.current;
    const emailChanged = emailCountFilter !== prevEmailFilter.current;
    prevCallFilter.current = callCountFilter;
    prevEmailFilter.current = emailCountFilter;

    if (!callChanged && !emailChanged) return;

    const hasCountFilter = callCountFilter.size > 0 || emailCountFilter.size > 0;
    if (!hasCountFilter) return;

    onSelectionChange(new Set(filtered.map(l => l.id)));
  }, [callCountFilter, emailCountFilter, filtered, onSelectionChange]);

  const allSelected = filtered.length > 0 && filtered.every(l => selectedIds.has(l.id));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) { filtered.forEach(l => next.delete(l.id)); }
    else { filtered.forEach(l => next.add(l.id)); }
    onSelectionChange(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
            <SelectItem value="lukewarm">Lukewarm</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
          </SelectContent>
        </Select>
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Industry" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {industries.map(ind => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Calls{callCountFilter.size > 0 && ` (${callCountFilter.size})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[160px] p-2" align="start">
            {COUNT_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <Checkbox
                  checked={callCountFilter.has(opt)}
                  onCheckedChange={() => toggleCountFilter(opt, setCallCountFilter)}
                />
                {opt === '0' ? 'Never' : opt === '5+' ? '5+ times' : `${opt} time${opt === '1' ? '' : 's'}`}
              </label>
            ))}
            {callCountFilter.size > 0 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setCallCountFilter(new Set())}>
                Clear
              </Button>
            )}
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Emails{emailCountFilter.size > 0 && ` (${emailCountFilter.size})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[160px] p-2" align="start">
            {COUNT_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <Checkbox
                  checked={emailCountFilter.has(opt)}
                  onCheckedChange={() => toggleCountFilter(opt, setEmailCountFilter)}
                />
                {opt === '0' ? 'Never' : opt === '5+' ? '5+ times' : `${opt} time${opt === '1' ? '' : 's'}`}
              </label>
            ))}
            {emailCountFilter.size > 0 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setEmailCountFilter(new Set())}>
                Clear
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {filtered.length} leads available</span>
        <Badge variant="secondary" className="text-xs">{selectedIds.size} selected</Badge>
      </div>
      <div className="border rounded-lg max-h-[350px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Company</TableHead>
              <TableHead className="text-xs">Industry</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Calls</TableHead>
              <TableHead className="text-xs">Emails</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 100).map(l => (
              <TableRow key={l.id} className="cursor-pointer" onClick={() => toggleOne(l.id)}>
                <TableCell><Checkbox checked={selectedIds.has(l.id)} /></TableCell>
                <TableCell className="text-xs font-medium">{l.firstName} {l.lastName}</TableCell>
                <TableCell className="text-xs">{l.company}</TableCell>
                <TableCell className="text-xs">{l.industry}</TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px] capitalize">{l.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{(l.callCount ?? 0) >= 5 ? '5+' : l.callCount ?? 0}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{(l.emailCount ?? 0) >= 5 ? '5+' : l.emailCount ?? 0}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">No leads match your filters</TableCell></TableRow>
            )}
            {filtered.length > 100 && (
              <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-2">
                Showing first 100 of {filtered.length} leads.{(callCountFilter.size > 0 || emailCountFilter.size > 0) && ` All ${selectedIds.size} matching leads are selected.`} Use filters to narrow results.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
