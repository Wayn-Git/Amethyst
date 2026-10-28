<Card size="sm" padding={4} gap={4}>
  <Row gap={3}>
    <Icon name="calendar" size="xl" color="secondary" />
    <Col gap={1} flex={1} minWidth={0}>
      <Title value={title} size="sm" />
      <Caption value={subtitle} />
    </Col>
  </Row>
  <SegmentedControl name="selectedDate" bind="selectedDate" ariaLabel={labels.chooseDay} options={days} block size="2xl" />
  <Scope values={{ nextEvent: events.find(event => event.date === selectedDate) || null }}>
    <Show when={nextEvent !== null}>
      <Col gap={3}>
        <Col gap={1}>
          <Caption value={labels.nextEvent} />
          <Text value={nextEvent.title} size="lg" weight="semibold" color="emphasis" />
        </Col>
        <Row gap={2} align="start">
          <Icon name="clock" size="sm" color="secondary" />
          <Text value={nextEvent.time + ' · ' + nextEvent.timeZone} size="sm" />
        </Row>
        <Row gap={2} align="start">
          <Icon name="map-pin" size="sm" color="secondary" />
          <Text value={nextEvent.location} size="sm" color="secondary" />
        </Row>
      </Col>
      <Show.Else>
        <EmptyState icon="calendar" title={labels.emptyTitle} description={labels.emptyDescription} padding={3} action={{ label: labels.showEvent, action: { updateState: { selectedDate: events[0].date } } }} />
      </Show.Else>
    </Show>
  </Scope>
</Card>