<Scope values={{ featured: tasks[0], urgentCount: size(tasks.filter(task => task.severity !== 'watch')), totalRemaining: sum(tasks, 'remaining') }}>
  <Basic theme={darkMode ? 'dark' : 'light'} gap={3} align="center">
    <Col width="100%" maxWidth={400} gap={3}>
      <Row gap={3} justify="between">
        <Col gap={1} minWidth={0}>
          <Title value={labels.galleryTitle} size="sm" />
          <Caption value={labels.gallerySubtitle} />
        </Col>
        <Toggle bind="darkMode" variant="switch" label={labels.darkMode} />
      </Row>
      <SegmentedControl name="sizeChoice" bind="sizeChoice" options={sizes} ariaLabel={labels.sizeLabel} block size="xl" $onChangeAction='{ updateState: { direction: value === "small" ? "minimal" : value === "medium" ? "priority" : "digest" } }' />
      <SegmentedControl name="direction" bind="direction" options={directions[sizeChoice]} ariaLabel={labels.directionLabel} block size="xl" />
      <Card size="full" padding={0} gap={0} shadow={false} theme={darkMode ? 'dark' : 'light'}>
        <Show when={direction === 'minimal'}>
          <Col padding={5} gap={4}>
            <Row justify="between" gap={2}>
              <Caption value={labels.highestRisk} weight="medium" />
              <Badge label={featured.risk} color="danger" variant="soft" icon="alert-triangle" />
            </Row>
            <Col gap={2}>
              <Title value={featured.title} size="md" />
              <Text value={featured.dueFull} size="sm" weight="medium" />
            </Col>
            <Text value={featured.reason} size="sm" color="secondary" />
            <Divider />
            <Row justify="between" gap={3} align="baseline">
              <Text value={String(featured.remaining) + labels.hoursLeft} size="sm" weight="semibold" />
              <Text value={String(featured.available) + labels.hoursScheduled} size="sm" color="secondary" />
            </Row>
          </Col>
          <Show.ElseIf when={direction === 'timeline'}>
            <Col padding={5} gap={4}>
              <Col gap={1}>
                <Caption value={labels.deadlineWindow} />
                <Title value={labels.dueTomorrow} size="lg" />
                <Text value={featured.title} size="sm" weight="semibold" />
              </Col>
              <Row gap={2}>
                <Icon name="alert-triangle" color="danger" size="sm" />
                <Text value={featured.risk + labels.riskSuffix} size="sm" weight="medium" color="danger" />
              </Row>
              <Timeline items={deadlineTimeline} gap={3} />
              <Divider />
              <Text value={String(featured.remaining) + labels.hoursWorkOnly + String(featured.available) + labels.hoursBeforeDue} size="sm" />
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={direction === 'priority'}>
            <Col padding={4} gap={4}>
              <Col gap={1}>
                <Caption value={labels.priorityEyebrow} />
                <Title value={labels.priorityTitle} size="md" />
                <Text value={labels.priorityIntro} size="sm" color="secondary" />
              </Col>
              <Col gap={0}>
                <Each of={tasks.slice(0, 4)} item="task" index="i">
                  <Col key={task.id} gap={3} padding={{ y: 3 }}>
                    <Row align="start" gap={3}>
                      <Box size={28} radius="sm" background="surface-secondary" align="center" justify="center">
                        <Text value={String(i + 1)} size="sm" weight="semibold" color="secondary" tabularNums />
                      </Box>
                      <Col flex={1} minWidth={0} gap={1}>
                        <Row gap={2} justify="between" align="start" wrap="wrap">
                          <Text value={task.risk} size="xs" weight="semibold" color={task.tone} />
                          <Caption value={String(task.remaining) + labels.hoursLeft} tabularNums />
                        </Row>
                        <Text value={task.title} size="sm" weight="semibold" />
                        <Caption value={task.dueFull} />
                        <Text value={task.reason} size="sm" color="secondary" />
                      </Col>
                    </Row>
                    <Show when={i < 3}><Divider color="subtle" /></Show>
                  </Col>
                </Each>
              </Col>
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={direction === 'capacity'}>
            <Col padding={4} gap={4}>
              <Col gap={1}>
                <Caption value={labels.capacityEyebrow} />
                <Title value={labels.capacityTitle} size="md" />
                <Text value={labels.capacityNote} size="sm" color="secondary" />
              </Col>
              <Each of={tasks.slice(0, 4)} item="task" index="i">
                <Col key={task.id} gap={2}>
                  <Row justify="between" align="baseline" gap={2} wrap="wrap">
                    <Text value={task.title} size="sm" weight="semibold" />
                    <Text value={task.risk} size="xs" weight="semibold" color={task.tone} />
                  </Row>
                  <Caption value={task.dueFull} />
                  <Col gap={2} padding={{ y: 1 }}>
                    <Row gap={3}>
                      <Col width={100} gap={0}><Caption value={labels.workLeft} /><Text value={String(task.remaining) + labels.hourUnit} size="sm" weight="medium" tabularNums /></Col>
                      <Col flex={1}><Progress value={task.remaining} max={max(task.remaining, task.available)} showValue={false} color={task.tone} size="sm" /></Col>
                    </Row>
                    <Row gap={3}>
                      <Col width={100} gap={0}><Caption value={labels.available} /><Text value={String(task.available) + labels.hourUnit} size="sm" weight="medium" tabularNums /></Col>
                      <Col flex={1}><Progress value={task.available} max={max(task.remaining, task.available)} showValue={false} color="secondary" size="sm" /></Col>
                    </Row>
                  </Col>
                  <Text value={task.remaining > task.available ? String(task.remaining - task.available) + labels.hoursShort : String(task.available - task.remaining) + labels.hoursBuffer} size="sm" weight="medium" color={task.remaining > task.available ? 'danger' : 'secondary'} />
                  <Text value={task.reason} size="sm" color="secondary" />
                  <Show when={i < 3}><Divider color="subtle" spacing={2} /></Show>
                </Col>
              </Each>
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={direction === 'digest'}>
            <Col padding={4} gap={4}>
              <Col gap={2}>
                <Caption value={labels.digestEyebrow} />
                <Title value={String(urgentCount) + labels.urgentDeadlines} size="md" />
                <Text value={String(size(tasks.filter(task => task.severity === 'watch'))) + labels.watchSummary + String(totalRemaining) + labels.hoursWorkLeft} size="sm" color="secondary" />
              </Col>
              <Divider />
              <Each of={groups} item="group">
                <Col key={group.id} gap={3}>
                  <Row justify="between" gap={2}>
                    <Row gap={2}><Icon name={group.icon} size="sm" color={group.tone} /><Text value={group.label} size="sm" weight="semibold" color={group.tone} /></Row>
                    <Caption value={pluralize(size(tasks.filter(task => task.severity === group.id)), labels.deadlineNoun)} />
                  </Row>
                  <Each of={tasks.filter(task => task.severity === group.id)} item="task">
                    <Col key={task.id} gap={1} padding={{ bottom: 2 }}>
                      <Text value={task.title} size="sm" weight="semibold" />
                      <Caption value={task.dueFull + labels.dot + String(task.remaining) + labels.hoursLeft} />
                      <Row gap={3} padding={{ y: 1 }}>
                        <Col flex={1}><Progress value={task.progress} max={100} showValue={false} color="secondary" size="sm" /></Col>
                        <Caption value={String(task.progress) + labels.percentComplete} tabularNums />
                      </Row>
                      <Text value={task.reason} size="sm" color="secondary" />
                    </Col>
                  </Each>
                </Col>
              </Each>
              <Text value={labels.digestNote} size="sm" color="secondary" />
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={direction === 'editorial'}>
            <Col gap={0}>
              <Col padding={5} gap={4}>
                <Row justify="between" gap={2} wrap="wrap">
                  <Caption value={labels.projectName} />
                  <Text value={featured.risk + labels.riskSuffix} size="xs" weight="semibold" color="danger" />
                </Row>
                <Col gap={2}>
                  <Title value={labels.editorialTitle} size="lg" />
                  <Text value={featured.title} size="sm" weight="medium" />
                  <Text value={labels.editorialIntro} size="sm" color="secondary" />
                </Col>
                <Col gap={2}>
                  <Row justify="between" gap={2}><Caption value={labels.reviewProgress} /><Text value={String(featured.progress) + labels.percent} size="sm" weight="semibold" tabularNums /></Row>
                  <Progress value={featured.progress} max={100} showValue={false} color="secondary" size="md" />
                </Col>
                <Box background="surface-secondary" padding={3} radius="lg" gap={3}>
                  <KeyValue rows={[{ label: labels.due, value: featured.dueFull }, { label: labels.workLeft, value: String(featured.remaining) + labels.hourUnit }, { label: labels.scheduledCapacity, value: String(featured.available) + labels.hourUnit }]} gap={2} />
                </Box>
                <Col gap={2}>
                  <Text value={labels.contributingFactors} size="sm" weight="semibold" />
                  <List marker="disc" gap={2}>
                    <Each of={featured.factors} item="factor"><List.Item><Text value={factor} size="sm" color="secondary" /></List.Item></Each>
                  </List>
                </Col>
              </Col>
              <Divider flush color="subtle" />
              <Col padding={4} gap={4}>
                <Col gap={1}>
                  <Text value={labels.restOfRelease} size="sm" weight="semibold" />
                  <Text value={String(size(tasks)) + labels.deadlinesTotal + String(totalRemaining) + labels.hoursWorkLeft} size="sm" color="secondary" />
                </Col>
                <Each of={groups} item="group">
                  <Col key={group.id} gap={3}>
                    <Row justify="between" gap={2}>
                      <Text value={group.label} size="xs" weight="semibold" color={group.tone} />
                      <Caption value={String(size(tasks.filter(task => task.severity === group.id && task.id !== featured.id)))} />
                    </Row>
                    <Each of={tasks.filter(task => task.severity === group.id && task.id !== featured.id)} item="task">
                      <Col key={task.id} gap={1}>
                        <Text value={task.title} size="sm" weight="medium" />
                        <Caption value={task.dueFull + labels.dot + String(task.remaining) + labels.hoursLeft} />
                        <Row gap={3} padding={{ y: 1 }}>
                          <Col flex={1}><Progress value={task.progress} max={100} showValue={false} color="secondary" size="sm" /></Col>
                          <Caption value={String(task.progress) + labels.percentComplete} tabularNums />
                        </Row>
                        <Text value={task.reason} size="sm" color="secondary" />
                      </Col>
                    </Each>
                  </Col>
                </Each>
                <Text value={labels.editorialSummary} size="sm" color="secondary" />
              </Col>
            </Col>
          </Show.ElseIf>
        </Show>
      </Card>
      <Caption value={labels.snapshot} />
    </Col>
  </Basic>
</Scope>