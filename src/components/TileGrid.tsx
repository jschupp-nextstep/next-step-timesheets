import type { ReactNode } from 'react'
import { Card, Col, Row, Typography } from 'antd'
import { Link } from 'react-router'

export type Tile = { to: string; title: string; description: string; icon: ReactNode }
export type TileSection = { title?: string; tiles: Tile[] }

// Home-page tiles (admin, coach, scheduler): one clickable card per screen,
// name plus a one-line description. Stacks to one column on a phone.
export const TileGrid = ({ sections }: { sections: TileSection[] }) => (
  <>
    {sections.map((section, i) => (
      <div key={section.title ?? i} style={{ marginBottom: 24 }}>
        {section.title && (
          <Typography.Title level={5} type="secondary" style={{ marginBottom: 12 }}>
            {section.title}
          </Typography.Title>
        )}
        <Row gutter={[16, 16]}>
          {section.tiles.map((tile) => (
            <Col key={tile.to} xs={24} sm={12} lg={8} xl={6}>
              <Link to={tile.to} style={{ display: 'block', height: '100%' }}>
                <Card hoverable style={{ height: '100%' }} styles={{ body: { padding: 16 } }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 24, color: '#1677ff', lineHeight: 1 }}>{tile.icon}</div>
                    <div>
                      <Typography.Text strong style={{ fontSize: 15 }}>
                        {tile.title}
                      </Typography.Text>
                      <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 13 }}>
                        {tile.description}
                      </Typography.Paragraph>
                    </div>
                  </div>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      </div>
    ))}
  </>
)
