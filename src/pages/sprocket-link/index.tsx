import { useState } from 'react'
import { Alert, App, Button, Card, Select, Space, Table, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import Papa from 'papaparse'

import { supabaseClient } from '../../utility/supabaseClient'
import { checkImportFile } from '../../utility/importFileCheck'
import { fileDateRange, planLinks, type AppRowCandidate, type LinkPlan, type SprocketRawRow } from '../../utility/sprocketLink'
import { loadKnownSprocketIds, loadUnlinkedAppRows } from '../../utility/sprocketLinkData'

// Phase 9 step 4: after uploading an "Export to Sprocket" file, export the
// calendar from Sprocket and upload it here. Each row Sprocket created for
// one of our sessions gets its ID saved (sprocket_link_rows, 0037).

const LEAVE = '__leave__'

const describeSprocket = (r: SprocketRawRow) =>
  `${r.StartDate} ${r.StartDateTime} · ${r.Title || (r.Opponent ? `vs ${r.Opponent}` : '(no title)')} · ${r.TeamName || 'Club'} · ${
    r.LocationName || '(no location)'
  }`

export const SprocketLink = () => {
  const { message } = App.useApp()
  const [plan, setPlan] = useState<LinkPlan | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState<number | null>(null)

  const handleFile = async (file: File) => {
    const text = await file.text()
    const wrongFile = checkImportFile(file.name, text, 'sprocket')
    if (wrongFile) {
      message.error({ content: wrongFile, duration: 8 })
      return false
    }
    setChecking(true)
    setError(null)
    setPlan(null)
    setPicks({})
    setLinked(null)
    try {
      const rows = Papa.parse<SprocketRawRow>(text, { header: true, skipEmptyLines: true }).data
      const range = fileDateRange(rows)
      if (!range) {
        setError('No dated rows in this file.')
        return false
      }
      const ids = rows.map((r) => r.ClubCalendarEventID?.trim()).filter((id): id is string => !!id)
      const [app, known] = await Promise.all([loadUnlinkedAppRows(range.from, range.to), loadKnownSprocketIds(ids)])
      if (app.error || known.error) {
        setError(`${app.error ?? known.error} -- has migration 0037 been run?`)
        return false
      }
      setPlan(planLinks(rows, app.rows, known.known))
    } finally {
      setChecking(false)
    }
    return false
  }

  const chosen = (plan?.ambiguous ?? []).flatMap((a) => {
    const id = a.sprocket.ClubCalendarEventID
    const pick = picks[id]
    const app = a.candidates.find((c) => c.rowId === pick)
    return app ? [{ sprocket: a.sprocket, app }] : []
  })
  const toLink = [...(plan?.auto ?? []), ...chosen]
  const duplicatePick = new Set(toLink.map((l) => l.app.rowId)).size !== toLink.length

  const link = async () => {
    if (!toLink.length || duplicatePick) return
    setLinking(true)
    try {
      const { data, error: rpcError } = await supabaseClient.rpc('sprocket_link_rows', {
        p_links: toLink.map((l) => ({
          row_id: l.app.rowId,
          club_calendar_event_id: l.sprocket.ClubCalendarEventID.trim(),
          sprocket_row: l.sprocket,
        })),
      })
      if (rpcError) {
        message.error({ content: rpcError.message, duration: 8 })
        return
      }
      setLinked(data as number)
      setPlan(null)
      message.success(`Linked ${data} row(s)`)
    } finally {
      setLinking(false)
    }
  }

  return (
    <div>
      <Typography.Title level={3}>Link Sprocket IDs</Typography.Title>
      <Typography.Paragraph type="secondary">
        After uploading an Export to Sprocket file to Sprocket, export the calendar from Sprocket (covering the same
        dates) and upload it here. Each row Sprocket created for one of this app's sessions gets its Sprocket ID saved,
        so the next export updates it instead of creating it again, and Import Calendar won't duplicate it. Nothing in
        the schedule changes.
      </Typography.Paragraph>

      {linked !== null && (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          message={`Linked ${linked} Sprocket row(s)`}
          description="Those sessions are now managed here: Import Calendar won't change them."
        />
      )}

      {!plan && (
        <Upload.Dragger beforeUpload={handleFile} accept=".csv" showUploadList={false} maxCount={1} disabled={checking}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>{checking ? 'Checking…' : 'Click or drag a Sprocket calendar export here'}</p>
        </Upload.Dragger>
      )}
      {error && <Alert type="error" style={{ marginTop: 16 }} message="Couldn't check the file" description={error} />}

      {plan && (
        <>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message={`${plan.auto.length} row(s) match automatically${plan.ambiguous.length ? `, ${plan.ambiguous.length} need you to pick` : ''}`}
            description={
              <>
                <div>{plan.alreadyLinked} row(s) in the file are already linked or imported -- nothing to do.</div>
                {plan.notFromApp.length > 0 && (
                  <div>
                    {plan.notFromApp.length} row(s) weren't made in this app (or don't match one of its sessions) -- bring
                    those in with Import Calendar if they should be here.
                  </div>
                )}
              </>
            }
          />

          {plan.ambiguous.length > 0 && (
            <Card title={`Pick the session (${plan.ambiguous.length})`} size="small" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                More than one of this app's rows fits these Sprocket rows (same team, date and start), or two Sprocket rows
                fit the same session -- e.g. the file was uploaded to Sprocket twice. Pick which session each one is, or
                leave it. A duplicate in Sprocket should be deleted there.
              </Typography.Paragraph>
              <Table dataSource={plan.ambiguous} rowKey={(a) => a.sprocket.ClubCalendarEventID} size="small" pagination={false}>
                <Table.Column title="Sprocket row" render={(_, a: LinkPlan['ambiguous'][number]) => describeSprocket(a.sprocket)} />
                <Table.Column
                  title="Is this app session"
                  render={(_, a: LinkPlan['ambiguous'][number]) => (
                    <Select
                      style={{ width: 420 }}
                      value={picks[a.sprocket.ClubCalendarEventID] ?? LEAVE}
                      onChange={(v) => setPicks((p) => ({ ...p, [a.sprocket.ClubCalendarEventID]: v }))}
                      options={[
                        { label: 'Leave it (not linked)', value: LEAVE },
                        ...a.candidates.map((c: AppRowCandidate) => ({ label: c.label, value: c.rowId })),
                      ]}
                    />
                  )}
                />
              </Table>
            </Card>
          )}

          {plan.auto.length > 0 && (
            <Card title={`Matched (${plan.auto.length})`} size="small" style={{ marginTop: 16 }}>
              <Table dataSource={plan.auto} rowKey={(m) => m.sprocket.ClubCalendarEventID} size="small" pagination={{ pageSize: 25 }}>
                <Table.Column title="Sprocket ID" render={(_, m: LinkPlan['auto'][number]) => m.sprocket.ClubCalendarEventID} />
                <Table.Column title="Sprocket row" render={(_, m: LinkPlan['auto'][number]) => describeSprocket(m.sprocket)} />
                <Table.Column title="App session" render={(_, m: LinkPlan['auto'][number]) => m.app.label} />
              </Table>
            </Card>
          )}

          {plan.appLeft.length > 0 && (
            <Card title={`Not found in this file (${plan.appLeft.length})`} size="small" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                This app's rows in these dates that no Sprocket row matched -- not uploaded yet, or changed in Sprocket
                (time, team) before linking. Upload them with Export to Sprocket, or fix them in Sprocket to match.
              </Typography.Paragraph>
              <Table dataSource={plan.appLeft} rowKey="rowId" size="small" pagination={{ pageSize: 25 }}>
                <Table.Column dataIndex="label" title="App session" />
              </Table>
            </Card>
          )}

          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={!toLink.length || duplicatePick} loading={linking} onClick={link}>
              Link {toLink.length} row(s)
            </Button>
            <Button onClick={() => setPlan(null)}>Upload a different file</Button>
            {duplicatePick && <Typography.Text type="danger">Two Sprocket rows are picked for the same session.</Typography.Text>}
          </Space>
        </>
      )}
    </div>
  )
}
