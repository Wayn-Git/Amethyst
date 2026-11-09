<Basic gap={4} align="center">
  <Col width="100%" maxWidth={380} gap={3}>
    <Col gap={1}>
      <Title value={labels.title} size="sm" />
      <Caption value={labels.intro} />
    </Col>
    <Col gap={2}>
      <Label value={labels.composition} fieldName="composition" />
      <Select name="composition" bind="composition" options={compositions} block size="2xl" />
    </Col>
    <SegmentedControl name="sizeChoice" bind="sizeChoice" options={sizes} ariaLabel={labels.size} size="2xl" block />
  </Col>
  <Scope values={{ study: studies[composition][sizeChoice], palette: palettes[composition], compact: sizeChoice === 'small', large: sizeChoice === 'large' }}>
    <Box width={compact ? 160 : 340} maxWidth="100%" height={large ? 340 : 160} padding={compact ? 4 : 5} radius="2xl" background={palette.background} gap={3} justify={large ? 'between' : 'start'} border={{ size: 1, color: composition === 'split' || composition === 'bento' ? '#E8E8ED' : 'transparent' }}>
      <Show when={compact}>
        <Show when={composition === 'split'}>
          <Col gap={3}>
            <Text value={study.title} size="xs" weight="semibold" color={palette.ink} />
            <Title value={study.date} size="5xl" color={palette.accent} tabularNums />
            <Text value={study.start} size="xs" color={palette.muted} />
          </Col>
          <Show.ElseIf when={composition === 'neon'}>
            <Col gap={3}>
              <Text value={study.title} size="xs" weight="semibold" color={palette.title} />
              <Text value={study.start} size="xs" color={palette.muted} />
              <Title value={study.countdown} size="4xl" color={palette.accent} tabularNums />
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={composition === 'dot'}>
            <Col gap={3}>
              <Grid columns="repeat(10, 6px)" gap={1}>
                <Each of={study.matrix} item="dot" index="i">
                  <Box key={i} size={6} radius="full" background={dot === 2 ? '#FFE77B' : dot === 1 ? '#FFFFFF' : '#419C99'} />
                </Each>
              </Grid>
              <Text value={study.title} size="xs" weight="semibold" color={palette.ink} />
              <Title value={study.start} size="2xl" color={palette.ink} tabularNums />
            </Col>
          </Show.ElseIf>
          <Show.ElseIf when={composition === 'cobalt'}>
            <Col gap={3}>
              <Text value={study.title} size="xs" weight="semibold" color={palette.ink} />
              <Text value={study.start} size="xs" color={palette.muted} />
              <Title value={study.countdown} size="4xl" color={palette.accent} tabularNums />
            </Col>
          </Show.ElseIf>
          <Show.Else>
            <Col height="100%" justify="between" gap={3}>
              <Row gap={2} justify="between">
                <Text value={study.title} size="xs" weight="medium" color={palette.title} />
                <Text value={study.date} size="xl" weight="semibold" color="#ED5261" tabularNums />
              </Row>
              <Row gap={1} align="baseline">
                <Title value={study.startClock} size="3xl" color={palette.ink} tabularNums />
                <Text value={study.startPeriod} size="xs" color={palette.muted} />
              </Row>
            </Col>
          </Show.Else>
        </Show>
        <Show.Else>
          <Show when={composition === 'bento'}>
            <Col gap={3}>
              <Row justify="between" gap={3}>
                <Text value={study.title} size="xs" weight="semibold" color={palette.title} />
                <Text value={study.date} size="xs" weight="semibold" color="#ED5261" tabularNums />
              </Row>
              <Row gap={3} justify="between" align="baseline">
                <Row gap={1} align="baseline">
                  <Title value={study.startClock} size="3xl" color={palette.ink} tabularNums />
                  <Text value={study.startPeriod} size="xs" color={palette.muted} />
                </Row>
                <Row gap={1} align="baseline">
                  <Title value={study.endClock} size="3xl" color={palette.ink} tabularNums />
                  <Text value={study.endPeriod} size="xs" color={palette.muted} />
                </Row>
              </Row>
              <Grid columns={2} gap={3}>
                <Each of={study.resources} item="resource">
                  <Pressable key={resource.label} padding={2} radius="md" background="#F2F2F7" onClickAction={{ type: 'open_url', handler: 'client', payload: { url: resource.url } }}>
                    <Row gap={2} height={28}>
                      <Box width={3} height={24} radius="full" background="#178582" />
                      <Text value={resource.label} size="xs" weight="medium" color="#33333B" />
                      <Spacer />
                      <Icon name="arrow-up-right" size="xs" color="#178582" />
                    </Row>
                  </Pressable>
                </Each>
              </Grid>
            </Col>
            <Show.Else>
              <Row gap={3} align="center" height={large ? 104 : 120}>
                <Col width={composition === 'split' ? 100 : 140} minWidth={0} gap={2}>
                  <Show when={composition === 'split'}>
                    <Col gap={0}>
                      <Title value={study.date} size="5xl" color={palette.accent} tabularNums />
                      <Text value={study.weekday} size="xs" weight="medium" color={palette.ink} />
                      <Text value={study.month} size="xs" color={palette.muted} />
                    </Col>
                    <Show.ElseIf when={composition === 'neon'}>
                      <Row gap={2} align="center">
                        <Avatar name={study.avatar} size={22} />
                        <Text value={study.title} size="xs" weight="semibold" color={palette.title} />
                      </Row>
                      <Text value={study.start} size="xs" color={palette.muted} />
                      <Title value={study.countdown} size="4xl" color={palette.accent} tabularNums />
                    </Show.ElseIf>
                    <Show.ElseIf when={composition === 'dot'}>
                      <Grid columns="repeat(10, 6px)" gap={1}>
                        <Each of={study.matrix} item="dot" index="i">
                          <Box key={i} size={6} radius="full" background={dot === 2 ? '#FFE77B' : dot === 1 ? '#FFFFFF' : '#419C99'} />
                        </Each>
                      </Grid>
                      <Text value={study.title} size="xs" weight="semibold" color={palette.ink} />
                      <Title value={study.start} size="2xl" color={palette.ink} tabularNums />
                    </Show.ElseIf>
                    <Show.Else>
                      <Row gap={2}>
                        <Icon name="empty-circle" size="sm" color="#FFFFFF" />
                        <Text value={study.title} size="xs" weight="semibold" color={palette.ink} />
                      </Row>
                      <Text value={study.start} size="xs" color={palette.muted} />
                      <Title value={study.countdown} size="4xl" color={palette.accent} tabularNums />
                    </Show.Else>
                  </Show>
                </Col>
                <Scope values={{ panel: composition === 'split' ? study : study.secondary }}>
                  <Row flex={1} minWidth={0} gap={2} align="stretch">
                    <Box width={3} minWidth={3} height={84} radius="full" background={panel.bar} />
                    <Col flex={1} minWidth={0} gap={2}>
                      <Text value={panel.title} size="xs" weight="semibold" color={palette.ink} />
                      <Text value={panel.start} size="xs" color={palette.muted} />
                      <Button label={labels.meet} ariaLabel={labels.meetAccessible} size="md" pill color={palette.meetColor} variant="solid" onClickAction={{ type: 'open_url', handler: 'client', payload: { url: meetingUrl } }} />
                    </Col>
                  </Row>
                </Scope>
              </Row>
            </Show.Else>
          </Show>
          <Show when={large}>
            <Col gap={2}>
              <Each of={study.agenda} item="event">
                <Row key={event.title} gap={2} height={30}>
                  <Box width={3} minWidth={3} height={28} radius="full" background={event.bar} />
                  <Show when={composition === 'cobalt'}>
                    <Icon name="empty-circle" size="sm" color="#FFFFFF" />
                  </Show>
                  <Col flex={1} minWidth={0} gap={0}>
                    <Text value={event.title} size="xs" weight="medium" color={palette.ink} />
                    <Text value={event.time} size="xs" color={palette.muted} />
                  </Col>
                  <Show when={composition === 'cobalt'}>
                    <Text value={event.countdown} size="md" weight="bold" color="#FFFFFF" tabularNums />
                  </Show>
                </Row>
              </Each>
            </Col>
            <Grid columns={6} gap={1}>
              <Each of={study.days} item="day">
                <Box key={day.label} align="center" justify="center">
                  <Box size={32} radius="full" align="center" justify="center" background={day.selected ? palette.dayActive : 'transparent'}>
                    <Text value={day.label} size="xs" weight={day.selected ? 'semibold' : 'normal'} color={day.selected ? palette.dayInk : palette.muted} />
                  </Box>
                </Box>
              </Each>
            </Grid>
          </Show>
        </Show.Else>
      </Show>
    </Box>
    <Col width="100%" maxWidth={380} gap={2}>
      <Caption value={compact ? labels.smallDimensions : large ? labels.largeDimensions : labels.mediumDimensions} textAlign="center" />
      <Text value={labels.disclosure} size="xs" color="secondary" />
    </Col>
  </Scope>
</Basic>