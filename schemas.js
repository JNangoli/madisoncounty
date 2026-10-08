// Example schemas. Both the sender's and receiver's app must ship the same definition;
// change `version` whenever you edit one (old links then fail cleanly instead of decoding wrongly).
export const WORK_ORDER = {
  id: 'work-order', version: 1,
  fields: [
    { name: 'ticket', type: 'int', required: true },
    { name: 'status', type: 'enum', values: ['open', 'pending', 'in-progress', 'closed'], required: true },
    { name: 'priority', type: 'enum', values: ['low', 'medium', 'high', 'urgent'] },
    { name: 'department', type: 'enum', values: ['Public Works', 'Planning', 'Finance', 'Parks', 'Utilities'] },
    { name: 'reported', type: 'date' },
    { name: 'updated', type: 'datetime' },
    { name: 'ward', type: 'int', min: 1, max: 12 },
    { name: 'cost', type: 'number', decimals: 2 },
    { name: 'publicSafety', type: 'bool' },
    { name: 'address', type: 'text' },
    { name: 'note', type: 'text' },
  ],
};

export const SAMPLE_WORK_ORDER = {
  ticket: 4512, status: 'pending', priority: 'high', department: 'Public Works',
  reported: '2026-10-06', updated: '2026-10-08T14:30:00Z', ward: 7, cost: 1250.5, publicSafety: true,
  address: '214 Elm Ave', note: 'Streetlight out, pole leaning',
};
