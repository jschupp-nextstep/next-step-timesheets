-- Zoho export needs to route W-2 and 1099 coach pay to entirely different
-- accounts and journal entries, and per the bookkeeping reference this
-- classification "must come from the coach roster, not be inferred."
-- Defaults everyone to 1099 (the overwhelming majority); the ~3 actual W-2
-- coaches need to be flipped manually via the Coaches admin screen rather
-- than name-matched here, since a slightly-off name match (a real recurring
-- problem with this roster) would misclassify someone's pay silently.
alter table coaches add column pay_type text not null default '1099' check (pay_type in ('1099', 'w2'));
