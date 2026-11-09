<Scope values={{ next: slots.find(slot => slot.id === nextId), best: slots.find(slot => slot.id === recommendedId), selected: slots.find(slot => slot.id === selectedId) }}>
  <Basic theme={appearance} align="center" gap={4} padding={1}>
    <Box width="100%" maxWidth={400} gap={3}>
      <Row gap={3}>
        <Col flex={1} minWidth={0} gap={1}>
          <Title value={labels.familyTitle} size="sm" />
          <Caption value={labels.sampleNote} />
        </Col>
        <Button iconStart={appearance === 'light' ? 'moon' : 'sun'} ariaLabel={appearance === 'light' ? labels.darkAppearance : labels.lightAppearance} uniform variant="ghost" size="2xl" onClickAction={{ updateState: { appearance: appearance === 'light' ? 'dark' : 'light' } }} />
      </Row>
      <SegmentedControl name="sizeChoice" bind="sizeChoice" ariaLabel={labels.sizeLabel} options={sizes} block size="2xl" />
      <SegmentedControl name="variation" bind="variation" ariaLabel={labels.variationLabel} options={variations[sizeChoice]} block size="2xl" />
    </Box>

    <Box width="100%" maxWidth={400} align="center">
      <Card size={sizeChoice === 'small' ? 'sm' : 'full'} theme={appearance} padding={5} gap={4} shadow={false}>
        <Show when={sizeChoice === 'small' && variation === 'first'}>
          <Col align="center" gap={4} padding={{ y: 2 }}>
            <Caption value={labels.nextFree} />
            <Col align="center" gap={2}>
              <Title value={next.range} size="2xl" tabularNums textAlign="center" />
              <Text value={next.durationLabel} size="lg" color="secondary" tabularNums />
            </Col>
            <Row gap={2} justify="center" wrap="wrap">
              <Icon name="clock" size="sm" color="secondary" />
              <Text value={labels.startsIn} size="sm" color="secondary" />
            </Row>
          </Col>

          <Show.ElseIf when={sizeChoice === 'small' && variation === 'second'}>
            <Col gap={4}>
              <Row justify="between" gap={2} wrap="wrap">
                <Caption value={labels.nextOpenBlock} />
                <Text value={labels.startsIn} size="sm" color={colors.accent} />
              </Row>
              <Row align="baseline" gap={2}>
                <Title value={String(next.duration)} size="5xl" tabularNums />
                <Text value={labels.minutesClear} size="lg" color="secondary" />
              </Row>
              <Col border={{ left: { size: 2, color: colors.accent } }} padding={{ left: 3 }} gap={1}>
                <Text value={next.range} size="lg" weight="medium" tabularNums />
                <Text value={labels.smallFocusNote} size="sm" color="secondary" />
              </Col>
            </Col>
          </Show.ElseIf>

          <Show.ElseIf when={sizeChoice === 'medium' && variation === 'first'}>
            <Col gap={4}>
              <Row align="baseline" justify="between" gap={2}>
                <Title value={labels.availableToday} size="sm" />
                <Caption value={labels.threeWindows} />
              </Row>
              <Col gap={0}>
                <Each of={slots.filter(slot => slot.medium)} item="slot" index="i">
                  <Col key={slot.id} gap={0}>
                    <Show when={i > 0}><Divider color="subtle" /></Show>
                    <Pressable padding={{ y: 3, x: 2 }} radius="sm" background={selectedId === slot.id ? colors.selection : 'surface-elevated'} onClickAction={{ updateState: { selectedId: slot.id } }}>
                      <Col gap={2}>
                        <Row gap={3} justify="between" wrap="wrap">
                          <Text value={slot.range} size="lg" weight="medium" tabularNums />
                          <Text value={slot.durationLabel} size="sm" color={selectedId === slot.id ? colors.accent : 'secondary'} weight="medium" tabularNums />
                        </Row>
                        <Text value={slot.before + ' → ' + slot.after} size="sm" color="secondary" />
                        <Show when={slot.id === recommendedId}>
                          <Text value={labels.bestForFocus} size="sm" color={colors.accent} weight="medium" />
                        </Show>
                      </Col>
                    </Pressable>
                  </Col>
                </Each>
              </Col>
            </Col>
          </Show.ElseIf>

          <Show.ElseIf when={sizeChoice === 'medium' && variation === 'second'}>
            <Col gap={4}>
              <Col gap={2}>
                <Caption value={labels.bestUpcoming} />
                <Title value={labels.noonHeadline} size="lg" />
              </Col>
              <Pressable padding={4} radius="lg" background={colors.selection} onClickAction={{ updateState: { selectedId: best.id } }}>
                <Col gap={3}>
                  <Row align="baseline" gap={2} wrap="wrap">
                    <Title value={String(best.duration)} size="3xl" tabularNums />
                    <Text value={labels.minutesUninterrupted} size="sm" color="secondary" />
                  </Row>
                  <Text value={best.range} size="lg" weight="medium" tabularNums />
                  <Text value={best.before + ' → ' + best.after} size="sm" color="secondary" />
                </Col>
              </Pressable>
              <Col gap={3}>
                <Caption value={labels.alsoOpen} />
                <Each of={slots.filter(slot => slot.medium && slot.id !== recommendedId)} item="slot">
                  <Pressable key={slot.id} radius="sm" padding={2} background={selectedId === slot.id ? colors.selection : 'surface-elevated'} onClickAction={{ updateState: { selectedId: slot.id } }}>
                    <Col gap={1}>
                      <Row justify="between" gap={2} wrap="wrap">
                        <Text value={slot.range} size="sm" weight="medium" tabularNums />
                        <Text value={slot.durationLabel} size="sm" color="secondary" tabularNums />
                      </Row>
                      <Text value={slot.before + ' → ' + slot.after} size="sm" color="secondary" />
                    </Col>
                  </Pressable>
                </Each>
              </Col>
            </Col>
          </Show.ElseIf>

          <Show.ElseIf when={sizeChoice === 'large' && variation === 'first'}>
            <Col gap={4}>
              <Col gap={2}>
                <Row align="baseline" justify="between" gap={3} wrap="wrap">
                  <Title value={labels.dayTimeline} size="sm" />
                  <Text value={labels.remainingTotal} size="sm" color="secondary" tabularNums />
                </Row>
                <Text value={labels.recommendationLine} size="sm" weight="medium" color={colors.accent} />
              </Col>
              <Col gap={2}>
                <Each of={slots} item="slot">
                  <Col key={slot.id} gap={1}>
                    <Row gap={3} align="start" padding={{ x: 2, y: 1 }}>
                      <Col width={46}><Caption value={slot.beforeStart} tabularNums /></Col>
                      <Col flex={1} minWidth={0}><Text value={slot.before} size="sm" color="secondary" /></Col>
                    </Row>
                    <Pressable padding={2} radius="sm" disabled={!slot.upcoming} background={selectedId === slot.id ? colors.selection : 'surface-elevated'} onClickAction={{ updateState: { selectedId: slot.id } }}>
                      <Row gap={3} align="stretch">
                        <Col width={46} gap={1} padding={{ y: 1 }}>
                          <Text value={slot.start} size="sm" weight="medium" color={slot.upcoming ? 'primary' : 'secondary'} tabularNums />
                          <Caption value={slot.end} tabularNums />
                        </Col>
                        <Col flex={1} minWidth={0} gap={1} padding={{ left: 3, y: 1 }} border={{ left: { size: slot.id === recommendedId ? 2 : 1, color: slot.id === recommendedId ? colors.accent : 'subtle' } }}>
                          <Row justify="between" gap={2} wrap="wrap">
                            <Text value={slot.upcoming ? labels.freeTime : labels.earlierFree} size="sm" weight="medium" color={slot.upcoming ? 'primary' : 'secondary'} />
                            <Text value={slot.durationLabel} size="sm" color="secondary" tabularNums />
                          </Row>
                          <Show when={slot.id === recommendedId}>
                            <Text value={labels.bestForFocus} size="sm" weight="medium" color={colors.accent} />
                          </Show>
                        </Col>
                      </Row>
                    </Pressable>
                  </Col>
                </Each>
                <Row gap={3} align="start" padding={{ x: 2, y: 1 }}>
                  <Col width={46}><Caption value={closingEvent.start} tabularNums /></Col>
                  <Col flex={1} minWidth={0}><Text value={closingEvent.title} size="sm" color="secondary" /></Col>
                </Row>
              </Col>
            </Col>
          </Show.ElseIf>

          <Show.Else>
            <Col gap={4}>
              <Col gap={3}>
                <Caption value={labels.editorialEyebrow} />
                <Title value={labels.editorialHeadline} size="lg" />
                <Row align="baseline" gap={3} wrap="wrap">
                  <Title value={String(best.duration)} size="4xl" tabularNums />
                  <Col gap={1}>
                    <Text value={labels.minutesUninterrupted} size="sm" color="secondary" />
                    <Text value={best.range} size="lg" weight="medium" tabularNums />
                  </Col>
                </Row>
                <Text value={labels.editorialReason} size="sm" color="secondary" />
              </Col>
              <Divider />
              <Col gap={3}>
                <Row justify="between" gap={2} wrap="wrap">
                  <Text value={labels.dayAtGlance} size="sm" weight="semibold" />
                  <Caption value={labels.remainingTotal} />
                </Row>
                <Each of={slots} item="slot" index="i">
                  <Col key={slot.id} gap={3}>
                    <Show when={i > 0}><Divider color="subtle" /></Show>
                    <Pressable radius="sm" padding={2} disabled={!slot.upcoming} background={selectedId === slot.id ? colors.selection : 'surface-elevated'} onClickAction={{ updateState: { selectedId: slot.id } }}>
                      <Col gap={2}>
                        <Row justify="between" gap={2} wrap="wrap">
                          <Text value={slot.range} size="sm" weight="medium" color={slot.upcoming ? 'primary' : 'secondary'} tabularNums />
                          <Text value={slot.durationLabel} size="sm" color="secondary" tabularNums />
                        </Row>
                        <Col gap={1} padding={{ left: 3 }} border={{ left: { size: 1, color: slot.id === recommendedId ? colors.accent : 'subtle' } }}>
                          <Text value={slot.before + ' → ' + slot.after} size="sm" color="secondary" />
                          <Show when={slot.id === recommendedId}>
                            <Text value={labels.recommended} size="sm" weight="medium" color={colors.accent} />
                            <Show.ElseIf when={!slot.upcoming}><Caption value={labels.earlierToday} /></Show.ElseIf>
                          </Show>
                        </Col>
                      </Col>
                    </Pressable>
                  </Col>
                </Each>
              </Col>
            </Col>
          </Show.Else>
        </Show>

        <Show when={sizeChoice !== 'small'}>
          <Divider color="subtle" />
          <Col gap={2}>
            <Caption value={labels.selectedPrefix + selected.range} />
            <Show when={motion}>
              <Transition><Text key={selected.id} value={selected.note} size="sm" /></Transition>
              <Show.Else><Text value={selected.note} size="sm" /></Show.Else>
            </Show>
          </Col>
        </Show>
      </Card>
    </Box>

    <Show when={sizeChoice !== 'small'}>
      <Row width="100%" maxWidth={400} justify="between" gap={3} padding={{ x: 1 }}>
        <Text value={labels.motionLabel} size="sm" color="secondary" />
        <Toggle name="motion" bind="motion" variant="switch" label={labels.motionLabel} />
      </Row>
    </Show>
  </Basic>
</Scope>