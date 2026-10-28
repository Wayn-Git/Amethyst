<Scope values={{ clockMs: demoStartMs + elapsedMinutes * 60000, timed: deadlines.map(item => ({ source: item, remaining: item.offsetMinutes - elapsedMinutes })) }}>
  <Scope values={{ entries: timed.map(item => ({ source: item.source, remaining: item.remaining, countdown: item.remaining < 0 ? labels.overdue : item.remaining === 0 ? labels.dueNow : item.remaining >= 1440 ? String(floor(item.remaining / 1440)) + 'd ' + String(floor((item.remaining % 1440) / 60)) + 'h' : String(floor(item.remaining / 60)) + 'h ' + String(item.remaining % 60).padStart(2, '0') + 'm' })), dayEnd: (floor((882 + elapsedMinutes) / 1440) + 1) * 1440 - 882, weekEnd: (floor((882 + elapsedMinutes) / 10080) + 1) * 10080 - 882 }}>
    <Scope values={{ nearest: entries[0], milestone: entries[7], groups: groupDefinitions.map(group => ({ id: group.id, label: group.id === 'today' && entries.some(entry => entry.remaining < 0) ? labels.todayOverdue : group.label, items: entries.filter(entry => group.id === 'today' ? entry.source.offsetMinutes < dayEnd : group.id === 'week' ? entry.source.offsetMinutes >= dayEnd && entry.source.offsetMinutes < weekEnd : entry.source.offsetMinutes >= weekEnd) })) }}>
      <Basic gap={4} align="center" theme={darkAppearance ? 'dark' : 'light'}>
        <Col width="100%" maxWidth={440} gap={3}>
          <Row gap={3} justify="between" wrap="wrap">
            <Col gap={1}>
              <Caption value={labels.collection} />
              <Title value={labels.title} size="sm" />
            </Col>
            <Toggle bind="darkAppearance" label={labels.darkAppearance} variant="switch" />
          </Row>
          <SegmentedControl bind="sizeChoice" options={sizeOptions} ariaLabel={labels.sizeSelector} block size="2xl" />
          <SegmentedControl bind="variation" options={directions[sizeChoice]} ariaLabel={labels.directionSelector} size="2xl" />
          <Caption value={labels.sampleNote} />
        </Col>

        <Box width="100%" maxWidth={sizeChoice === 'small' ? 320 : sizeChoice === 'medium' ? 400 : 440}>
          <Card size="full" padding={sizeChoice === 'small' ? 5 : 4} gap={0} shadow={false} theme={darkAppearance ? 'dark' : 'light'}>
            <Show when={sizeChoice === 'small' && variation === 'first'}>
              <Col key="small-minimal" gap={5}>
                <Col align="center" gap={3} padding={{ top: 3, bottom: 2 }}>
                  <Caption value={labels.timeRemaining} />
                  <Title value={nearest.countdown} size="5xl" tabularNums textAlign="center" />
                  <Col align="center" gap={1}>
                    <Text value={nearest.source.title} size="lg" weight="semibold" textAlign="center" />
                    <Caption value={nearest.source.project} textAlign="center" />
                  </Col>
                </Col>
                <Divider />
                <Row justify="center" gap={2} wrap="wrap">
                  <Icon name="calendar" size="sm" color="secondary" />
                  <Text value={nearest.source.dateLabel} size="sm" color="secondary" />
                </Row>
              </Col>
            </Show>

            <Show when={sizeChoice === 'small' && variation === 'second'}>
              <Col key="small-priority" gap={4}>
                <Row gap={2}>
                  <Icon name="alert-circle" size="sm" color={nearest.remaining < 0 ? 'danger' : 'warning'} />
                  <Text value={labels.attentionFirst} size="sm" weight="medium" color={nearest.remaining < 0 ? 'danger' : 'warning'} />
                </Row>
                <Text value={nearest.source.title} size="lg" weight="semibold" />
                <Col gap={1}>
                  <Title value={nearest.remaining <= 0 ? nearest.countdown : String(floor(nearest.remaining / 60)).padStart(2, '0') + ':' + String(nearest.remaining % 60).padStart(2, '0')} size="5xl" tabularNums />
                  <Caption value={labels.hoursMinutes} />
                </Col>
                <Divider />
                <Col gap={1}>
                  <Text value={nearest.source.project} size="sm" weight="medium" />
                  <Caption value={nearest.source.dateLabel} />
                  <Text value={nearest.source.note} size="sm" color="secondary" />
                </Col>
              </Col>
            </Show>

            <Show when={sizeChoice === 'medium' && variation === 'first'}>
              <Col key="medium-timeline" gap={5}>
                <Row justify="between" gap={3}>
                  <Title value={labels.comingUp} size="sm" />
                  <Caption value={labels.nextFour} />
                </Row>
                <Timeline gap={4} items={entries.slice(0, 4).map((entry, index) => ({ title: entry.source.title, description: entry.source.project + '\n' + entry.source.dateLabel, time: entry.countdown, icon: index === 0 ? 'clock' : 'empty-circle', color: entry.remaining < 0 ? 'danger' : index === 0 ? 'warning' : 'secondary' }))} />
              </Col>
            </Show>

            <Show when={sizeChoice === 'medium' && variation === 'second'}>
              <Col key="medium-priority" gap={4}>
                <Row justify="between" gap={2}>
                  <Caption value={labels.attentionFirst} color="warning" />
                  <Icon name="clock" size="sm" color="warning" />
                </Row>
                <Col gap={2}>
                  <Text value={nearest.source.title} size="lg" weight="semibold" />
                  <Title value={nearest.countdown} size="4xl" tabularNums />
                  <Caption value={nearest.source.project + ' · ' + nearest.source.dateLabel} />
                  <Text value={nearest.source.note} size="sm" color="secondary" />
                </Col>
                <Divider />
                <Col gap={4}>
                  <Each of={entries.slice(1, 4)} item="entry">
                    <Col key={entry.source.id} gap={1}>
                      <Row align="start" gap={3}>
                        <Col flex={1} minWidth={0}><Text value={entry.source.title} size="sm" weight="semibold" /></Col>
                        <Text value={entry.countdown} size="sm" weight="semibold" tabularNums />
                      </Row>
                      <Caption value={entry.source.project} />
                      <Caption value={entry.source.dateLabel} />
                    </Col>
                  </Each>
                </Col>
              </Col>
            </Show>

            <Show when={sizeChoice === 'large' && variation === 'first'}>
              <Col key="large-grouped" gap={5}>
                <Col gap={2}>
                  <Title value={labels.yourDeadlines} size="sm" />
                  <Text value={String(size(groups[0].items)) + labels.todaySuffix + ' · ' + String(size(groups[1].items)) + labels.weekSuffix + ' · ' + String(size(groups[2].items)) + labels.laterSuffix} size="sm" color="secondary" />
                </Col>
                <Each of={groups} item="group">
                  <Show when={size(group.items) > 0}>
                    <Col key={group.id} gap={3}>
                      <Row gap={3}>
                        <Text value={group.label} size="sm" weight="semibold" color={group.id === 'today' ? 'warning' : 'primary'} />
                        <Spacer />
                        <Caption value={String(size(group.items))} tabularNums />
                      </Row>
                      <Divider />
                      <Each of={group.items} item="entry">
                        <Col key={entry.source.id} gap={2} padding={{ y: 1 }}>
                          <Row align="start" gap={3}>
                            <Col flex={1} minWidth={0}><Text value={entry.source.title} size="sm" weight="semibold" /></Col>
                            <Text value={entry.countdown} size="sm" weight="semibold" tabularNums color={entry.remaining < 0 ? 'danger' : group.id === 'today' ? 'warning' : 'primary'} />
                          </Row>
                          <Caption value={entry.source.project + ' · ' + entry.source.compactDate} />
                          <Row gap={3}>
                            <Col flex={1} minWidth={0}><Progress value={entry.source.progress} max={100} showValue={false} size="sm" /></Col>
                            <Caption value={String(entry.source.progress) + '%'} tabularNums />
                          </Row>
                        </Col>
                      </Each>
                    </Col>
                  </Show>
                </Each>
                <Divider />
                <Col gap={1}>
                  <Caption value={labels.upNext} />
                  <Text value={nearest.source.title + ' · ' + nearest.source.dateLabel} size="sm" weight="medium" />
                  <Caption value={labels.progressNote} />
                </Col>
              </Col>
            </Show>

            <Show when={sizeChoice === 'large' && variation === 'second'}>
              <Col key="large-editorial" gap={5}>
                <Col gap={3} padding={{ top: 2 }}>
                  <Caption value={labels.majorMilestone} />
                  <Title value={milestone.source.title} size="xl" />
                  <Title value={milestone.countdown} size="5xl" tabularNums />
                  <Col gap={1}>
                    <Text value={milestone.source.project} size="sm" weight="medium" />
                    <Caption value={milestone.source.dateLabel} />
                  </Col>
                  <Col gap={2}>
                    <Row justify="between" gap={2}>
                      <Caption value={labels.launchPreparation} />
                      <Text value={String(milestone.source.progress) + '%'} size="sm" tabularNums />
                    </Row>
                    <Progress value={milestone.source.progress} max={100} showValue={false} size="sm" />
                  </Col>
                </Col>
                <Divider />
                <Col gap={4}>
                  <Row justify="between" gap={2}>
                    <Text value={labels.beforeMilestone} size="sm" weight="semibold" />
                    <Caption value={labels.sevenDeadlines} />
                  </Row>
                  <Each of={entries.slice(0, 7)} item="entry" index="index">
                    <Row key={entry.source.id} align="start" gap={3}>
                      <Text value={String(index + 1).padStart(2, '0')} size="sm" color="tertiary" tabularNums />
                      <Col flex={1} minWidth={0} gap={1}>
                        <Text value={entry.source.title} size="sm" weight="medium" />
                        <Caption value={entry.source.project} />
                        <Caption value={entry.source.compactDate} />
                      </Col>
                      <Col align="end" gap={2}>
                        <Text value={entry.countdown} size="sm" weight="semibold" tabularNums color={entry.remaining < 0 ? 'danger' : index < 2 ? 'warning' : 'primary'} />
                        <Row gap={2}>
                          <Box width={36}><Progress value={entry.source.progress} max={100} showValue={false} size="sm" /></Box>
                          <Caption value={String(entry.source.progress) + '%'} tabularNums />
                        </Row>
                      </Col>
                    </Row>
                  </Each>
                </Col>
                <Divider />
                <Col gap={2}>
                  <Text value={String(size(entries)) + labels.totalSuffix + ' · ' + String(size(groups[0].items)) + labels.todaySuffix} size="sm" weight="medium" />
                  <Caption value={labels.nextPrefix + nearest.source.title + ' · ' + nearest.source.compactDate} />
                  <Caption value={labels.progressNote} />
                </Col>
              </Col>
            </Show>
          </Card>
        </Box>

        <Col width="100%" maxWidth={440} gap={1}>
          <Row gap={2}>
            <Col flex={1} minWidth={0}>
              <Caption value={labels.clockPrefix + formatDate(clockMs, 'datetime', { timeZone: 'UTC' }) + ' UTC'} />
            </Col>
            <Button iconStart={clockRunning ? 'pause' : 'play'} ariaLabel={clockRunning ? labels.pauseClock : labels.resumeClock} uniform variant="ghost" size="2xl" onClickAction={{ updateState: { clockRunning: !clockRunning } }} />
            <Button iconStart="reload" ariaLabel={labels.resetClock} uniform variant="ghost" size="2xl" onClickAction={{ updateState: { elapsedMinutes: 0, clockRunning: true } }} />
          </Row>
          <Caption value={labels.clockNote} size="sm" />
        </Col>
        <Show when={clockRunning}>
          <RunInterval interval={60000} $onTickAction='{ updateState: { elapsedMinutes: elapsedMinutes + 1 } }' />
        </Show>
      </Basic>
    </Scope>
  </Scope>
</Scope>