-- Reimbursements (ice for camp, lunch for coaches, etc.) aren't coach labor
-- at all -- whoever's reimbursed enters a variable dollar amount + what it
-- was for, never hours, never a rate lookup. None of the existing entry
-- modes fit that (direct_flat's amount comes from a rate lookup, not a
-- typed-in figure), so this needs its own mode.
alter table programs drop constraint programs_entry_mode_check;
alter table programs add constraint programs_entry_mode_check
  check (entry_mode in ('session', 'direct_time', 'direct_flat', 'admin_only', 'backend_only', 'reimbursement'));

insert into programs (name, code, entry_mode)
values ('Reimbursement', 'REIMB', 'reimbursement');
