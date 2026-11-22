import { describe, expect, it } from 'vitest'

import { seriesDates, weekdayNames } from './sessionSeries'

describe('seriesDates', () => {
  it('is one session when there is no end date', () => {
    expect(seriesDates({ firstDate: '2027-01-09', lastDate: null, weekdays: [], skipDates: [] }).dates).toEqual(['2027-01-09'])
  })

  it("builds DSA winter: Saturdays 1/9 to 3/13, none 1/16", () => {
    const { dates, unusedSkips } = seriesDates({
      firstDate: '2027-01-09',
      lastDate: '2027-03-13',
      weekdays: [6],
      skipDates: ['2027-01-16'],
    })
    expect(dates).toHaveLength(9)
    expect(dates[0]).toBe('2027-01-09')
    expect(dates[1]).toBe('2027-01-23')
    expect(dates.at(-1)).toBe('2027-03-13')
    expect(unusedSkips).toEqual([])
  })

  it('builds Medway futsal: Fridays 1/8 to 2/26, none 2/19', () => {
    const { dates } = seriesDates({ firstDate: '2027-01-08', lastDate: '2027-02-26', weekdays: [5], skipDates: ['2027-02-19'] })
    expect(dates).toEqual(['2027-01-08', '2027-01-15', '2027-01-22', '2027-01-29', '2027-02-05', '2027-02-12', '2027-02-26'])
  })

  it('handles several weekdays and starts on the first matching day, not the start date', () => {
    // 2027-01-07 is a Thursday.
    const { dates } = seriesDates({ firstDate: '2027-01-07', lastDate: '2027-01-20', weekdays: [1, 3], skipDates: [] })
    expect(dates).toEqual(['2027-01-11', '2027-01-13', '2027-01-18', '2027-01-20'])
  })

  it('reports skip dates that were never going to be sessions', () => {
    const { unusedSkips } = seriesDates({
      firstDate: '2027-01-09',
      lastDate: '2027-01-30',
      weekdays: [6],
      skipDates: ['2027-01-17', '2027-02-06', '2027-01-16'],
    })
    expect(unusedSkips).toEqual(['2027-01-17', '2027-02-06'])
  })

  it('flags more than the cap', () => {
    expect(seriesDates({ firstDate: '2027-01-01', lastDate: '2027-12-31', weekdays: [1, 2, 3], skipDates: [] }).tooMany).toBe(true)
  })

  it('is empty without a start date or with an end before the start', () => {
    expect(seriesDates({ firstDate: '', lastDate: null, weekdays: [], skipDates: [] }).dates).toEqual([])
    expect(seriesDates({ firstDate: '2027-02-01', lastDate: '2027-01-01', weekdays: [1], skipDates: [] }).dates).toEqual([])
  })
})

describe('weekdayNames', () => {
  it('lists days Monday first', () => {
    expect(weekdayNames([0, 3, 1])).toBe('Mon, Wed, Sun')
  })
})
