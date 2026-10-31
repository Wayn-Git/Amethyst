<Scope values={{ workItems: schedule.filter(item => item.work), focusItems: schedule.filter(item => item.kind === 'focus'), calendarItems: schedule.filter(item => item.kind === 'event'), breakItems: schedule.filter(item => item.kind === 'break'), workMinutes: sum(schedule.filter(item => item.work), 'minutes'), focusMinutes: sum(schedule.filter(item => item.kind === 'focus'), 'minutes'), freeMinutes: dayMinutes - sum(schedule, 'minutes'), next: schedule[0] }}>
  <Basic gap={4} align="center" theme={appearance}>
    <Col width="100%" maxWidth={400} gap={4}>
      <Col gap={1}>
        <Title value={collectionTitle} size="sm" />
        <Caption value={collectionNote} />
      </Col>
      <Col gap={3}>
        <Col gap={2}>
          <Label value={labels.direction} fieldName="direction" />
          <Select name="direction" bind="direction" options={directions} block size="2xl" />
        </Col>
        <Row gap={3} wrap="wrap" justify="between">
          <SegmentedControl name="sizeChoice" bind="sizeChoice" ariaLabel={labels.size} options={sizes} size="xl" />
          <SegmentedControl name="appearance" bind="appearance" ariaLabel={labels.appearance} options={appearances} size="xl" />
        </Row>
      </Col>
      <Transition>
        <Card key={direction + '-' + sizeChoice + '-' + appearance} size="full" width={sizeChoice === 'small' ? 'min(100%, 320px)' : '100%'} theme={appearance} padding={5} gap={4}>
          <Row justify="between" gap={2} wrap="wrap">
            <Caption value={dateLabel} weight="medium" />
            <Caption value={sizeChoice === 'large' ? dayRange : labels.dailyPlan} />
          </Row>
          <Show when={sizeChoice === 'small'}>
            <Show when={direction === 'minimal'}>
              <Col gap={3}>
                <Col gap={1}>
                  <Caption value={labels.nextRecommended} />
                  <Title value={next.title} size="lg" />
                </Col>
                <Row gap={2} wrap="wrap">
                  <Text value={next.start} size="sm" weight="semibold" tabularNums />
                  <Text value={'· ' + String(next.minutes) + ' min'} size="sm" color="secondary" />
                </Row>
                <Divider />
                <Caption value={smallMeetingNote} />
              </Col>
              <Show.ElseIf when={direction === 'timeline'}>
                <Col gap={3}>
                  <Row gap={4} align="start">
                    <Title value={next.start} size="2xl" tabularNums />
                    <Col gap={2} minWidth={0} flex={1}>
                      <Text value={next.title} weight="semibold" />
                      <Caption value={String(next.minutes) + ' min · ' + labels.next} />
                    </Col>
                  </Row>
                  <Row gap={3}>
                    <Box width={2} height={24} background="surface-tertiary" radius="full" />
                    <Caption value={smallBreakNote} />
                  </Row>
                </Col>
              </Show.ElseIf>
              <Show.ElseIf when={direction === 'focus'}>
                <Col gap={3}>
                  <Row gap={2} align="baseline">
                    <Title value={String(next.minutes)} size="4xl" tabularNums />
                    <Text value={labels.minutesOfFocus} size="sm" color="secondary" />
                  </Row>
                  <Text value={next.title} weight="semibold" />
                  <Row gap={2} justify="between" wrap="wrap">
                    <Caption value={labels.startsAt + next.start} />
                    <Caption value={next.priority + labels.prioritySuffix} />
                  </Row>
                </Col>
              </Show.ElseIf>
              <Show.ElseIf when={direction === 'balanced'}>
                <Col gap={3}>
                  <Text value={smallBalancedHeading} size="sm" color="secondary" />
                  <Title value={next.title} size="lg" />
                  <Row gap={2} justify="between" wrap="wrap">
                    <Text value={next.start + '–' + next.end} size="sm" weight="medium" tabularNums />
                    <Text value={String(next.minutes) + ' min'} size="sm" color="secondary" />
                  </Row>
                  <Box border={{ top: 1 }} padding={{ top: 3 }}>
                    <Caption value={smallBufferNote} />
                  </Box>
                </Col>
              </Show.ElseIf>
              <Show.Else>
                <Col gap={3}>
                  <Title value={smallEditorialHeading} size="2xl" />
                  <Text value={next.title} size="sm" weight="medium" />
                  <Text value={next.start + ' · ' + String(next.minutes) + ' min'} size="sm" color="secondary" tabularNums />
                  <Caption value={smallEditorialNote} />
                </Col>
              </Show.Else>
            </Show>
            <Show.ElseIf when={sizeChoice === 'medium'}>
              <Show when={direction === 'minimal'}>
                <Col gap={4}>
                  <Col gap={2}>
                    <Caption value={labels.nextRecommended} />
                    <Title value={next.title} size="lg" />
                    <Text value={next.start + ' · ' + String(next.minutes) + ' min · ' + next.priority + labels.prioritySuffix} size="sm" color="secondary" />
                    <Text value={next.note} size="sm" />
                  </Col>
                  <Divider />
                  <Col gap={3}>
                    <Each of={workItems.slice(1)} item="item">
                      <Row key={item.id} gap={3} align="start">
                        <Text value={item.start} size="sm" color="secondary" width={46} tabularNums />
                        <Col gap={1} flex={1} minWidth={0}>
                          <Text value={item.title} size="sm" weight="medium" />
                          <Caption value={String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix} />
                        </Col>
                      </Row>
                    </Each>
                  </Col>
                </Col>
                <Show.ElseIf when={direction === 'timeline'}>
                  <Col gap={4}>
                    <Title value={mediumTimelineHeading} size="lg" />
                    <Timeline gap={4} items={workItems.map((item, index) => ({ title: (index === 0 ? labels.nextPrefix : '') + item.title, description: String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix, time: item.start, icon: index === 0 ? 'arrow-right' : 'empty-circle', color: 'secondary' }))} />
                  </Col>
                </Show.ElseIf>
                <Show.ElseIf when={direction === 'focus'}>
                  <Col gap={4}>
                    <Box background="surface-secondary" padding={4} radius="xl" gap={3}>
                      <Caption value={labels.nextFocusBlock} />
                      <Row gap={4} align="start">
                        <Col gap={0}>
                          <Title value={String(next.minutes)} size="3xl" tabularNums />
                          <Caption value={labels.minutes} />
                        </Col>
                        <Col gap={2} flex={1} minWidth={0}>
                          <Text value={next.title} weight="semibold" />
                          <Caption value={next.start + ' · ' + next.priority + labels.prioritySuffix} />
                        </Col>
                      </Row>
                      <Text value={next.note} size="sm" color="secondary" />
                    </Box>
                    <Col gap={3}>
                      <Each of={workItems.slice(1)} item="item">
                        <Col key={item.id} gap={1}>
                          <Row gap={2} justify="between" align="start">
                            <Text value={item.title} size="sm" weight="medium" />
                            <Text value={item.start} size="sm" color="secondary" tabularNums />
                          </Row>
                          <Caption value={String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix} />
                        </Col>
                      </Each>
                    </Col>
                  </Col>
                </Show.ElseIf>
                <Show.ElseIf when={direction === 'balanced'}>
                  <Col gap={3}>
                    <Title value={mediumBalancedHeading} size="lg" />
                    <Col gap={1}>
                      <Caption value={labels.nextRecommended} />
                      <Text value={next.title} weight="semibold" />
                      <Caption value={next.start + ' · ' + String(next.minutes) + ' min · ' + next.priority + labels.prioritySuffix} />
                    </Col>
                    <Row gap={3} padding={{ y: 3 }}>
                      <Box width={3} height={32} background="info" radius="full" />
                      <Col gap={1}>
                        <Text value={calendarItems[0].title} size="sm" weight="medium" />
                        <Caption value={calendarItems[0].start + '–' + calendarItems[0].end + ' · ' + labels.calendar} />
                      </Col>
                    </Row>
                    <Each of={workItems.slice(1)} item="item">
                      <Row key={item.id} gap={3} align="start">
                        <Text value={item.start} width={46} size="sm" color="secondary" tabularNums />
                        <Col gap={1} flex={1} minWidth={0}>
                          <Text value={item.title} size="sm" weight="medium" />
                          <Caption value={String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix} />
                        </Col>
                      </Row>
                    </Each>
                  </Col>
                </Show.ElseIf>
                <Show.Else>
                  <Col gap={4}>
                    <Col gap={2}>
                      <Title value={mediumEditorialHeading} size="lg" />
                      <Text value={editorialGuidance} size="sm" color="secondary" />
                    </Col>
                    <Each of={workItems} item="item" index="index">
                      <Row key={item.id} gap={3} align="start">
                        <Text value={String(index + 1).padStart(2, '0')} size="sm" color="tertiary" width={24} tabularNums />
                        <Col gap={1} flex={1} minWidth={0}>
                          <Text value={item.title} size="sm" weight={index === 0 ? 'semibold' : 'medium'} />
                          <Caption value={item.start + ' · ' + String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix} />
                          <Show when={index === 0}><Text value={labels.beginHere} size="sm" color="secondary" /></Show>
                        </Col>
                      </Row>
                    </Each>
                  </Col>
                </Show.Else>
              </Show>
              <Caption value={mediumScopeNote} />
            </Show.ElseIf>
            <Show.Else>
              <Show when={direction === 'minimal'}>
                <Col gap={4}>
                  <Col gap={2}>
                    <Caption value={labels.nextRecommended} />
                    <Title value={next.title} size="lg" />
                    <Text value={next.start + '–' + next.end + ' · ' + String(next.minutes) + ' min'} size="sm" color="secondary" />
                    <Text value={next.note} size="sm" />
                  </Col>
                  <Divider />
                  <Col gap={3}>
                    <Each of={schedule.slice(1)} item="item">
                      <Row key={item.id} gap={3} align="start">
                        <Text value={item.start} width={46} size="sm" color="secondary" tabularNums />
                        <Col gap={1} flex={1} minWidth={0}>
                          <Text value={item.title} size="sm" weight="medium" />
                          <Caption value={String(item.minutes) + ' min · ' + item.kindLabel} />
                        </Col>
                      </Row>
                    </Each>
                  </Col>
                </Col>
                <Show.ElseIf when={direction === 'timeline'}>
                  <Col gap={4}>
                    <Col gap={1}>
                      <Title value={largeTimelineHeading} size="lg" />
                      <Text value={timelineGuidance} size="sm" color="secondary" />
                    </Col>
                    <Timeline gap={4} items={schedule.map((item, index) => ({ title: (index === 0 ? labels.nextPrefix : '') + item.title, description: String(item.minutes) + ' min · ' + item.kindLabel, time: item.start + '–' + item.end, icon: item.icon, color: item.kind === 'event' ? 'info' : 'secondary' }))} />
                  </Col>
                </Show.ElseIf>
                <Show.ElseIf when={direction === 'focus'}>
                  <Col gap={4}>
                    <Col gap={1}>
                      <Caption value={labels.protectedFocus} />
                      <Row gap={2} align="baseline" wrap="wrap">
                        <Title value={String(floor(focusMinutes / 60)) + 'h ' + String(focusMinutes % 60) + 'm'} size="3xl" tabularNums />
                        <Text value={labels.twoBlocks} size="sm" color="secondary" />
                      </Row>
                    </Col>
                    <Col gap={3}>
                      <Each of={focusItems} item="item" index="index">
                        <Box key={item.id} background={index === 0 ? 'surface-secondary' : 'surface'} padding={index === 0 ? 4 : 0} radius="xl" gap={2}>
                          <Caption value={(index === 0 ? labels.nextPrefix : '') + item.start + '–' + item.end} />
                          <Text value={item.title} size={index === 0 ? 'lg' : 'md'} weight="semibold" />
                          <Caption value={String(item.minutes) + ' min · ' + item.priority + labels.prioritySuffix} />
                        </Box>
                      </Each>
                    </Col>
                    <Divider />
                    <Col gap={3}>
                      <Text value={labels.aroundFocus} size="sm" weight="semibold" />
                      <Each of={schedule.filter(item => item.kind !== 'focus')} item="item">
                        <Row key={item.id} gap={3} align="start">
                          <Text value={item.start} width={46} size="sm" color="secondary" tabularNums />
                          <Col gap={1} flex={1} minWidth={0}>
                            <Text value={item.title} size="sm" weight="medium" />
                            <Caption value={String(item.minutes) + ' min · ' + item.kindLabel} />
                          </Col>
                        </Row>
                      </Each>
                    </Col>
                  </Col>
                </Show.ElseIf>
                <Show.ElseIf when={direction === 'balanced'}>
                  <Col gap={4}>
                    <Col gap={2}>
                      <Title value={largeBalancedHeading} size="lg" />
                      <Text value={balancedGuidance} size="sm" color="secondary" />
                    </Col>
                    <Grid columns="repeat(auto-fit, minmax(min(100%, 150px), 1fr))" gap={5}>
                      <Col gap={4} minWidth={0}>
                        <Text value={labels.calendar} size="sm" weight="semibold" color="secondary" />
                        <Each of={calendarItems} item="item">
                          <Row key={item.id} gap={3} align="stretch">
                            <Box width={3} background="info" radius="full" />
                            <Col gap={1} flex={1} minWidth={0}>
                              <Text value={item.start} size="sm" weight="semibold" tabularNums />
                              <Text value={item.title} size="sm" />
                              <Caption value={String(item.minutes) + ' min'} />
                            </Col>
                          </Row>
                        </Each>
                      </Col>
                      <Col gap={4} minWidth={0}>
                        <Text value={labels.yourWork} size="sm" weight="semibold" color="secondary" />
                        <Each of={workItems} item="item" index="index">
                          <Col key={item.id} gap={1}>
                            <Text value={(index === 0 ? labels.nextPrefix : '') + item.start} size="sm" weight="semibold" tabularNums />
                            <Text value={item.title} size="sm" />
                            <Caption value={String(item.minutes) + ' min · ' + item.priority} />
                          </Col>
                        </Each>
                      </Col>
                    </Grid>
                    <Divider />
                    <Col gap={3}>
                      <Text value={labels.breaks} size="sm" weight="semibold" color="secondary" />
                      <Each of={breakItems} item="item">
                        <Row key={item.id} gap={3} align="start">
                          <Text value={item.start} width={46} size="sm" color="secondary" tabularNums />
                          <Col gap={1} flex={1} minWidth={0}>
                            <Text value={item.title} size="sm" />
                            <Caption value={String(item.minutes) + ' min'} />
                          </Col>
                        </Row>
                      </Each>
                    </Col>
                  </Col>
                </Show.ElseIf>
                <Show.Else>
                  <Col gap={5}>
                    <Col gap={2}>
                      <Title value={largeEditorialHeading} size="2xl" />
                      <Text value={editorialGuidance} size="sm" color="secondary" />
                      <Text value={editorialNextAction} size="sm" weight="medium" />
                    </Col>
                    <Each of={daySections} item="section">
                      <Col key={section.id} gap={3}>
                        <Row gap={3} align="baseline" justify="between">
                          <Text value={section.title} weight="semibold" />
                          <Caption value={section.range} />
                        </Row>
                        <Divider />
                        <Each of={schedule.filter(item => item.section === section.id)} item="item">
                          <Row key={item.id} gap={3} align="start">
                            <Text value={item.start} width={46} size="sm" color="secondary" tabularNums />
                            <Col gap={1} flex={1} minWidth={0}>
                              <Text value={item.title} size="sm" weight={item.work ? 'medium' : 'normal'} />
                              <Caption value={String(item.minutes) + ' min · ' + item.kindLabel} />
                            </Col>
                          </Row>
                        </Each>
                      </Col>
                    </Each>
                  </Col>
                </Show.Else>
              </Show>
              <Divider />
              <Col gap={3}>
                <KeyValue gap={2} rows={[{ label: labels.workload, value: String(floor(workMinutes / 60)) + 'h ' + String(workMinutes % 60) + 'm', emphasis: true }, { label: labels.freeTime, value: String(floor(freeMinutes / 60)) + 'h ' + String(freeMinutes % 60) + 'm' }]} />
                <Text value={freeWindows} size="sm" color="secondary" />
                <Caption value={accountingNote} />
              </Col>
            </Show.Else>
          </Show>
        </Card>
      </Transition>
      <Caption value={demoNote} />
    </Col>
  </Basic>
</Scope>