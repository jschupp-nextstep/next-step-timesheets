-- Recurrence support for the events/create.tsx "Weekly for N weeks" option --
-- each occurrence is a real, independent events row (not a recurrence
-- template), tagged with a shared series_id so the board can later
-- pre-select "the series" for bulk edit. Null for one-off events.
alter table events add column series_id uuid;
