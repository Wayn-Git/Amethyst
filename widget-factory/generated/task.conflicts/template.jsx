<Scope values={{ next: conflicts[0], featured: conflicts[2], totalOverlap: sum(conflicts, 'overlap') }}>
  <Basic theme={appearance} align="center" gap={4}>
    <Box width="100%" maxWidth={440} align="center" gap={4}>
      <Col width="100%" gap={3}>
        <Caption value={labels.demo} />
        <Row gap={3} wrap="wrap" align="end">
          <Col flex={1} minWidth={180} gap={2}>
            <Label value={labels.variation} fieldName="variation" />
            <Select name="variation" bind="variation" options={variations} block size="2xl" />
          </Col>
          <Col gap={2}>
            <Label value={labels.appearance} fieldName="appearance" />
            <SegmentedControl name="appearance" bind="appearance" options={appearances} ariaLabel={labels.appearance} size="2xl" />
          </Col>
        </Row>
      </Col>

      <Show when={variation === 'small-minimal'}>
        <Card size="sm" theme={appearance} padding={4} gap={3}>
          <Caption value={labels.calendarConflicts} />
          <Row align="baseline" gap={3}>
            <Title value={String(size(conflicts))} size="4xl" tabularNums />
            <Text value={labels.conflictsToday} size="sm" color="secondary" />
          </Row>
          <Divider />
          <Row gap={2}>
            <Icon name="clock" size="sm" color={palette.overlap} />
            <Caption value={labels.nextOverlap + ' · ' + next.window} color="primary" />
          </Row>
          <Col gap={2}>
            <Each of={next.events} item="event">
              <Row key={event.id} justify="between" gap={3} wrap="wrap">
                <Text value={event.title} size="sm" weight="medium" />
                <Caption value={event.time} tabularNums />
              </Row>
            </Each>
          </Col>
          <Text value={String(next.overlap) + labels.overlapSuffix} size="sm" color={palette.overlap} />
          <Row><Button label={labels.reviewAll} variant="ghost" iconEnd="arrow-right" size="2xl" onClickAction={{ updateState: { variation: 'large-daily' } }} /></Row>
        </Card>
      </Show>

      <Show when={variation === 'small-daily'}>
        <Card size="sm" theme={appearance} padding={4} gap={4}>
          <Row align="start" gap={4}>
            <Col width={68} gap={1} padding={{ right: 3 }} border={{ right: { size: 1, color: 'subtle' } }}>
              <Caption value={date.weekdayShort} color={palette.overlap} />
              <Title value={date.day} size="4xl" tabularNums />
              <Caption value={date.monthShort} />
            </Col>
            <Col flex={1} minWidth={0} gap={3}>
              <Col gap={1}>
                <Title value={labels.today} size="sm" />
                <Text value={String(size(conflicts)) + labels.conflictsSuffix} size="sm" color="secondary" />
              </Col>
              <Col gap={1}>
                <Caption value={labels.nextOverlap + ' · ' + next.window} />
                <Each of={next.events} item="event">
                  <Text key={event.id} value={event.title} size="sm" weight="medium" />
                </Each>
              </Col>
            </Col>
          </Row>
          <Row wrap="wrap" justify="between" gap={2}>
            <Text value={String(next.overlap) + labels.overlapSuffix} size="sm" color={palette.overlap} />
            <Button label={labels.openDay} iconEnd="arrow-right" variant="ghost" size="2xl" onClickAction={{ updateState: { variation: 'large-daily' } }} />
          </Row>
        </Card>
      </Show>

      <Show when={variation === 'medium-comparison'}>
        <Card size="md" theme={appearance} padding={4} gap={4}>
          <Col gap={1}>
            <Title value={labels.comparisonTitle} size="sm" />
            <Caption value={labels.threeOfFive + ' · ' + date.short} />
          </Col>
          <Each of={conflicts.slice(0, 3)} item="conflict" index="i">
            <Col key={conflict.id} gap={3}>
              <Row justify="between" gap={2} wrap="wrap">
                <Text value={conflict.window} size="sm" weight="semibold" tabularNums />
                <Show when={i === 0}><Badge label={labels.nextClash} color="warning" variant="soft" /></Show>
              </Row>
              <Grid columns="repeat(auto-fit, minmax(min(100%, 140px), 1fr))" gap={4}>
                <Each of={conflict.events} item="event">
                  <Col key={event.id} gap={1} minWidth={0}>
                    <Text value={event.title} size="sm" weight="medium" />
                    <Text value={event.time} size="sm" tabularNums />
                    <Caption value={event.calendar} />
                  </Col>
                </Each>
              </Grid>
              <Text value={String(conflict.overlap) + labels.overlapSuffix} size="sm" color={palette.overlap} />
            </Col>
            <Show when={i < 2}><Divider /></Show>
          </Each>
          <Row><Button label={labels.reviewAll} variant="ghost" iconEnd="arrow-right" size="2xl" onClickAction={{ updateState: { variation: 'large-daily' } }} /></Row>
        </Card>
      </Show>

      <Show when={variation === 'medium-editorial'}>
        <Card size="md" theme={appearance} padding={4} gap={4}>
          <Col gap={2}>
            <Caption value={labels.highestImpact} color={palette.overlap} />
            <Title value={labels.editorialTitle} size="lg" />
            <Text value={labels.editorialReason} size="sm" color="secondary" />
          </Col>
          <Col gap={3}>
            <Each of={featured.events} item="event">
              <Col key={event.id} gap={1}>
                <Row gap={2} justify="between" wrap="wrap">
                  <Text value={event.title} size="sm" weight="semibold" />
                  <Caption value={event.calendar} />
                </Row>
                <Text value={event.time} size="sm" tabularNums />
              </Col>
            </Each>
            <Row gap={2} wrap="wrap">
              <Icon name="alert-circle" size="sm" color={palette.overlap} />
              <Text value={featured.window + ' · ' + String(featured.overlap) + labels.overlapSuffix} size="sm" color={palette.overlap} />
            </Row>
          </Col>
          <Box background="surface-secondary" radius="md" padding={3} gap={2}>
            <Text value={labels.suggestionTitle} size="sm" weight="semibold" />
            <Text value={labels.suggestion} size="sm" />
            <Text value={labels.suggestionCaveat} size="sm" color="secondary" />
          </Box>
          <Col gap={3}>
            <Text value={labels.otherClashes} size="sm" weight="semibold" />
            <Each of={conflicts.slice(0, 2)} item="conflict" index="i">
              <Col key={conflict.id} gap={2}>
                <Row gap={2} justify="between" wrap="wrap">
                  <Caption value={conflict.window} color="primary" tabularNums />
                  <Caption value={String(conflict.overlap) + labels.overlapSuffix} />
                </Row>
                <Each of={conflict.events} item="event">
                  <Col key={event.id} gap={0}>
                    <Text value={event.title} size="sm" weight="medium" />
                    <Caption value={event.time + ' · ' + event.calendar} />
                  </Col>
                </Each>
              </Col>
              <Show when={i === 0}><Divider /></Show>
            </Each>
          </Col>
          <Caption value={labels.threeOfFive + ' · ' + date.short} />
        </Card>
      </Show>

      <Show when={variation === 'large-timeline'}>
        <Card size="md" theme={appearance} padding={4} gap={4}>
          <Row align="start" gap={3}>
            <Col flex={1} gap={1}>
              <Title value={labels.timelineTitle} size="sm" />
              <Caption value={date.long} />
              <Text value={String(totalOverlap) + labels.totalOverlapSuffix} size="sm" color={palette.overlap} />
            </Col>
            <Col align="end" gap={0}>
              <Title value={String(size(conflicts))} size="xl" tabularNums />
              <Caption value={labels.conflicts} />
            </Col>
          </Row>
          <Col gap={2}>
            <Row gap={2} wrap="wrap">
              <Box size={8} radius="2xs" background={palette.overlap} />
              <Caption value={labels.timelineLegend} />
            </Row>
            <Row width="100%" justify="between" gap={0}>
              <Each of={axis.ticks} item="tick"><Text key={tick} value={tick} size="xs" color="secondary" tabularNums /></Each>
            </Row>
          </Col>
          <Each of={conflicts} item="conflict" index="i">
            <Col key={conflict.id} gap={2}>
              <Row justify="between" gap={2} wrap="wrap">
                <Text value={conflict.window} size="sm" weight="semibold" tabularNums />
                <Text value={String(conflict.overlap) + labels.overlapSuffix + (i === 0 ? ' · ' + labels.next : '')} size="sm" color={palette.overlap} />
              </Row>
              <Each of={conflict.events} item="event">
                <Col key={event.id} gap={1}>
                  <Row gap={2} justify="between" wrap="wrap">
                    <Text value={event.title} size="sm" weight="medium" />
                    <Caption value={event.time} tabularNums />
                  </Row>
                  <Row gap={2} justify="between" wrap="wrap">
                    <Caption value={event.calendar} />
                    <Row gap={1}>
                      <Each of={event.participants} item="person"><Avatar key={person.name} name={person.name} size={20} /></Each>
                    </Row>
                  </Row>
                  <Row width="100%" gap={0} height={7} background="surface-secondary" radius="2xs" clip>
                    <Box width={String(event.start / axis.duration * 100) + '%'} height={7} />
                    <Box width={String((conflict.overlapStart - event.start) / axis.duration * 100) + '%'} height={7} background={palette.event} />
                    <Box width={String(conflict.overlap / axis.duration * 100) + '%'} height={7} background={palette.overlap} />
                    <Box width={String((event.end - conflict.overlapEnd) / axis.duration * 100) + '%'} height={7} background={palette.event} />
                    <Box width={String((axis.duration - event.end) / axis.duration * 100) + '%'} height={7} />
                  </Row>
                </Col>
              </Each>
            </Col>
            <Show when={i < size(conflicts) - 1}><Divider /></Show>
          </Each>
          <Caption value={labels.timelineFootnote} />
        </Card>
      </Show>

      <Show when={variation === 'large-daily'}>
        <Card size="md" theme={appearance} padding={4} gap={4}>
          <Row align="start" gap={4}>
            <Col gap={0}>
              <Caption value={date.weekday} />
              <Title value={date.day} size="4xl" tabularNums />
              <Caption value={date.monthYear} />
            </Col>
            <Spacer />
            <Col align="end" gap={1}>
              <Title value={labels.today} size="sm" />
              <Text value={String(size(conflicts)) + labels.conflictsSuffix} size="sm" weight="medium" />
              <Text value={String(totalOverlap) + labels.minutesOverlapSuffix} size="sm" color={palette.overlap} />
            </Col>
          </Row>
          <Divider />
          <Each of={conflicts} item="conflict" index="i">
            <Row key={conflict.id} align="start" gap={3}>
              <Col width={44} gap={1}>
                <Text value={conflict.at} size="sm" weight="medium" tabularNums />
                <Show when={i === 0}><Caption value={labels.next} color={palette.overlap} /></Show>
              </Col>
              <Col flex={1} minWidth={0} border={{ left: { size: 2, color: i === 0 ? palette.overlap : 'subtle' } }} padding={{ left: 3 }} gap={3}>
                <Text value={String(conflict.overlap) + labels.overlapSuffix} size="sm" weight="medium" color={palette.overlap} />
                <Each of={conflict.events} item="event">
                  <Col key={event.id} gap={1}>
                    <Text value={event.title} size="sm" weight="semibold" />
                    <Text value={event.time + ' · ' + event.calendar} size="sm" color="secondary" tabularNums />
                    <Caption value={event.participants.map(person => person.name).join(' · ')} />
                  </Col>
                </Each>
              </Col>
            </Row>
          </Each>
          <Caption value={labels.dailyFootnote} />
        </Card>
      </Show>
    </Box>
  </Basic>
</Scope>