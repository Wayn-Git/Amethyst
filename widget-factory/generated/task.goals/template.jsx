<Basic theme={darkMode ? 'dark' : 'light'} align="center" gap={4}>
  <Box width="100%" maxWidth={400} gap={4}>
    <Col gap={3}>
      <Row gap={3}>
        <Col flex={1} minWidth={0} gap={1}>
          <Title value={labels.title} size="sm" />
          <Caption value={labels.collectionNote} />
        </Col>
        <Button label={darkMode ? labels.light : labels.dark} iconStart={darkMode ? 'sun' : 'moon'} variant="ghost" size="2xl" ariaLabel={darkMode ? labels.switchLight : labels.switchDark} onClickAction={{ updateState: { darkMode: !darkMode } }} />
      </Row>
      <SegmentedControl name="previewSize" bind="previewSize" ariaLabel={labels.sizeLabel} options={sizes} block size="2xl" />
      <Row gap={3}>
        <Label value={labels.layoutLabel} fieldName="layout" />
        <Col flex={1} minWidth={0}>
          <Select name="layout" bind="layout" options={layouts} block size="2xl" />
        </Col>
      </Row>
    </Col>
    <Scope values={{ displayedGoals: previewSize === 'small' ? goals.slice(0, 1) : previewSize === 'medium' ? goals.slice(0, layout === 'progress' ? 2 : 3) : goals, focus: goals[0], focusCategory: categories.find(category => category.id === goals[0].category), palette: darkMode ? colors.dark : colors.light }}>
      <Scope values={{ overall: round(avg(displayedGoals.map(goal => goal.done / goal.total * 100))), orderedGoals: sortBy(displayedGoals, 'nextIso') }}>
        <Card size="full" width="100%" padding={5} gap={4} theme={darkMode ? 'dark' : 'light'}>
          <Show when={previewSize === 'large'}>
            <Col gap={3}>
              <Row gap={3} align="start">
                <Col flex={1} minWidth={0} gap={1}>
                  <Title value={layoutTitles[layout]} size="sm" />
                  <Caption value={labels.overall} />
                </Col>
                <Text value={String(overall) + '%'} size="xl" weight="semibold" tabularNums />
              </Row>
              <Progress value={overall} max={100} showValue={false} size="sm" color={palette.accent} />
              <Caption value={pluralize(size(displayedGoals), 'goal') + ' · ' + labels.averageNote} />
            </Col>
            <Divider />
          </Show>

          <Show when={layout === 'minimal'}>
            <Show when={previewSize === 'small'}>
              <Col gap={4}>
                <Col gap={1}>
                  <Caption value={labels.activeGoal} />
                  <Title value={focus.title} size="sm" />
                </Col>
                <Col gap={2}>
                  <Row justify="between" gap={3}>
                    <Text value={focus.metric} size="sm" color="secondary" />
                    <Text value={String(round(focus.done / focus.total * 100)) + '%'} size="sm" weight="semibold" tabularNums />
                  </Row>
                  <Progress value={focus.done} max={focus.total} showValue={false} size="sm" color={palette.accent} />
                </Col>
                <Caption value={labels.targetPrefix + focus.target} />
              </Col>
              <Show.Else>
                <Col gap={4}>
                  <Show when={previewSize === 'medium'}>
                    <Row justify="between" gap={3}>
                      <Title value={layoutTitles.minimal} size="sm" />
                      <Caption value={pluralize(size(displayedGoals), 'goal')} />
                    </Row>
                  </Show>
                  <Each of={displayedGoals} item="goal" index="i">
                    <Col key={goal.id} gap={2}>
                      <Row gap={3} align="start">
                        <Col flex={1} minWidth={0} gap={1}>
                          <Text value={goal.title} size="sm" weight="semibold" />
                          <Caption value={labels.targetPrefix + goal.target} />
                        </Col>
                        <Text value={String(round(goal.done / goal.total * 100)) + '%'} size="sm" weight="medium" tabularNums />
                      </Row>
                      <Progress value={goal.done} max={goal.total} showValue={false} size="sm" color={palette.accent} />
                      <Text value={labels.nextPrefix + goal.next} size="sm" color="secondary" />
                      <Show when={previewSize === 'large'}>
                        <Caption value={goal.recent} />
                      </Show>
                      <Show when={i < size(displayedGoals) - 1}><Divider color="subtle" spacing={1} /></Show>
                    </Col>
                  </Each>
                </Col>
              </Show.Else>
            </Show>
          </Show>

          <Show when={layout === 'progress'}>
            <Show when={previewSize === 'small'}>
              <Col gap={4}>
                <Row gap={4}>
                  <Svg size={82} viewBox="0 0 100 100" title={focus.title + ' · ' + String(round(focus.done / focus.total * 100)) + '% complete'} paths={[{ d: ringTrack, fill: 'none', stroke: palette.track, strokeWidth: 7 }, { d: focus.arc, fill: 'none', stroke: palette.accent, strokeWidth: 7 }]} />
                  <Col flex={1} minWidth={0} gap={1}>
                    <Title value={String(round(focus.done / focus.total * 100)) + '%'} size="3xl" tabularNums />
                    <Text value={focus.metric} size="sm" color="secondary" />
                  </Col>
                </Row>
                <Col gap={1}>
                  <Title value={focus.title} size="sm" />
                  <Caption value={labels.targetPrefix + focus.target} />
                </Col>
              </Col>
              <Show.ElseIf when={previewSize === 'medium'}>
                <Col gap={4}>
                  <Title value={layoutTitles.progress} size="sm" />
                  <Each of={displayedGoals} item="goal" index="i">
                    <Col key={goal.id} gap={3}>
                      <Row gap={4} align="center">
                        <Svg size={64} viewBox="0 0 100 100" title={goal.title + ' · ' + String(round(goal.done / goal.total * 100)) + '% complete'} paths={[{ d: ringTrack, fill: 'none', stroke: palette.track, strokeWidth: 7 }, { d: goal.arc, fill: 'none', stroke: palette.accent, strokeWidth: 7 }]} />
                        <Col flex={1} minWidth={0} gap={1}>
                          <Text value={goal.title} size="sm" weight="semibold" />
                          <Title value={String(round(goal.done / goal.total * 100)) + '%'} size="xl" tabularNums />
                          <Caption value={goal.metric} />
                        </Col>
                      </Row>
                      <Col gap={1}>
                        <Caption value={labels.milestonePrefix + goal.nextDate} />
                        <Text value={goal.next} size="sm" />
                        <Caption value={labels.targetPrefix + goal.target} />
                      </Col>
                      <Show when={i < size(displayedGoals) - 1}><Divider color="subtle" spacing={1} /></Show>
                    </Col>
                  </Each>
                </Col>
              </Show.ElseIf>
              <Show.Else>
                <Col gap={4}>
                  <Each of={displayedGoals} item="goal" index="i">
                    <Row key={goal.id} align="start" gap={3}>
                      <Svg size={38} viewBox="0 0 100 100" title={goal.title + ' · ' + String(round(goal.done / goal.total * 100)) + '% complete'} paths={[{ d: ringTrack, fill: 'none', stroke: palette.track, strokeWidth: 8 }, { d: goal.arc, fill: 'none', stroke: palette.accent, strokeWidth: 8 }]} />
                      <Col flex={1} minWidth={0} gap={2}>
                        <Row gap={2} align="start">
                          <Text value={goal.title} size="sm" weight="semibold" />
                          <Spacer />
                          <Text value={String(round(goal.done / goal.total * 100)) + '%'} size="sm" weight="semibold" tabularNums />
                        </Row>
                        <Caption value={goal.metric} />
                        <Text value={labels.nextPrefix + goal.next} size="sm" />
                        <Caption value={labels.targetPrefix + goal.target} />
                        <Text value={goal.recent} size="sm" color="secondary" />
                        <Show when={i < size(displayedGoals) - 1}><Divider color="subtle" spacing={1} /></Show>
                      </Col>
                    </Row>
                  </Each>
                </Col>
              </Show.Else>
            </Show>
          </Show>

          <Show when={layout === 'timeline'}>
            <Show when={previewSize === 'small'}>
              <Col gap={4}>
                <Row align="start" gap={4}>
                  <Col width={48} gap={0}>
                    <Caption value={focus.nextMonth} />
                    <Title value={focus.nextDay} size="2xl" tabularNums />
                  </Col>
                  <Col flex={1} minWidth={0} gap={2} border={{ left: { size: 1, color: 'subtle' } }} padding={{ left: 4 }}>
                    <Text value={focus.title} size="sm" weight="semibold" />
                    <Text value={focus.next} size="sm" color="secondary" />
                  </Col>
                </Row>
                <Col gap={2}>
                  <Row justify="between" gap={3}>
                    <Caption value={labels.targetPrefix + focus.target} />
                    <Text value={String(round(focus.done / focus.total * 100)) + '%'} size="sm" weight="medium" tabularNums />
                  </Row>
                  <Progress value={focus.done} max={focus.total} showValue={false} size="sm" color={palette.accent} />
                </Col>
              </Col>
              <Show.Else>
                <Col gap={3}>
                  <Show when={previewSize === 'medium'}><Title value={layoutTitles.timeline} size="sm" /></Show>
                  <Each of={orderedGoals} item="goal" index="i">
                    <Row key={goal.id} align="start" gap={3}>
                      <Col width={36} align="center" gap={0} padding={{ top: 1 }}>
                        <Text value={goal.nextDay} size="xl" weight="medium" tabularNums />
                        <Caption value={goal.nextMonth} />
                      </Col>
                      <Col flex={1} minWidth={0} gap={2} border={{ left: { size: 1, color: 'subtle' } }} padding={{ left: 4, bottom: i < size(orderedGoals) - 1 ? 4 : 0 }}>
                        <Show when={previewSize === 'medium'}>
                          <Text value={goal.next} size="sm" weight="medium" />
                          <Text value={goal.title} size="sm" color="secondary" />
                          <Show.Else>
                            <Text value={goal.title} size="sm" weight="semibold" />
                            <Text value={goal.next} size="sm" />
                          </Show.Else>
                        </Show>
                        <Row justify="between" gap={2}>
                          <Caption value={labels.targetPrefix + goal.target} />
                          <Text value={String(round(goal.done / goal.total * 100)) + '%'} size="sm" weight="medium" tabularNums />
                        </Row>
                        <Progress value={goal.done} max={goal.total} showValue={false} size="sm" color={palette.accent} />
                        <Show when={previewSize === 'large'}><Caption value={goal.recent} /></Show>
                      </Col>
                    </Row>
                  </Each>
                </Col>
              </Show.Else>
            </Show>
          </Show>

          <Show when={layout === 'grouped'}>
            <Show when={previewSize === 'small'}>
              <Row align="start" gap={4}>
                <Col width={62} gap={2} padding={{ top: 1 }}>
                  <Icon name={focusCategory.icon} size="lg" color="secondary" />
                  <Text value={focusCategory.label} size="sm" weight="medium" color="secondary" />
                </Col>
                <Col flex={1} minWidth={0} gap={3} padding={{ left: 4 }} border={{ left: { size: 1, color: 'subtle' } }}>
                  <Title value={focus.title} size="sm" />
                  <Row justify="between" gap={2}>
                    <Caption value={labels.targetPrefix + focus.target} />
                    <Text value={String(round(focus.done / focus.total * 100)) + '%'} size="sm" weight="semibold" tabularNums />
                  </Row>
                  <Progress value={focus.done} max={focus.total} showValue={false} size="sm" color={palette.accent} />
                  <Caption value={focus.metric} />
                </Col>
              </Row>
              <Show.Else>
                <Col gap={5}>
                  <Show when={previewSize === 'medium'}><Title value={layoutTitles.grouped} size="sm" /></Show>
                  <Each of={categories.filter(category => displayedGoals.some(goal => goal.category === category.id))} item="category">
                    <Scope values={{ groupGoals: displayedGoals.filter(goal => goal.category === category.id) }}>
                      <Col key={category.id} gap={3}>
                        <Row gap={2}>
                          <Icon name={category.icon} size="sm" color="secondary" />
                          <Text value={category.label} size="sm" weight="medium" color="secondary" />
                          <Spacer />
                          <Caption value={String(size(groupGoals))} />
                        </Row>
                        <Each of={groupGoals} item="goal" index="i">
                          <Col key={goal.id} gap={2} padding={{ left: 5 }}>
                            <Row gap={3} align="start">
                              <Text value={goal.title} size="sm" weight="semibold" />
                              <Spacer />
                              <Text value={String(round(goal.done / goal.total * 100)) + '%'} size="sm" tabularNums />
                            </Row>
                            <Progress value={goal.done} max={goal.total} showValue={false} size="sm" color={palette.accent} />
                            <Caption value={labels.targetPrefix + goal.target} />
                            <Text value={labels.nextPrefix + goal.next} size="sm" color="secondary" />
                            <Show when={previewSize === 'large'}><Caption value={goal.recent} /></Show>
                            <Show when={i < size(groupGoals) - 1}><Divider color="subtle" spacing={1} /></Show>
                          </Col>
                        </Each>
                      </Col>
                    </Scope>
                  </Each>
                </Col>
              </Show.Else>
            </Show>
          </Show>

          <Show when={layout === 'editorial'}>
            <Col gap={4}>
              <Caption value={labels.focusNote} />
              <Show when={previewSize === 'small'}>
                <Col gap={3}>
                  <Title value={String(round(focus.done / focus.total * 100)) + '%'} size="4xl" tabularNums />
                  <Title value={focus.title} size="lg" />
                  <Progress value={focus.done} max={focus.total} showValue={false} size="sm" color={palette.accent} />
                  <Caption value={labels.targetPrefix + focus.target} />
                  <Text value={labels.nextPrefix + focus.next} size="sm" color="secondary" />
                </Col>
                <Show.Else>
                  <Col gap={3}>
                    <Title value={focus.title} size="lg" />
                    <Row gap={4} align="center">
                      <Title value={String(round(focus.done / focus.total * 100)) + '%'} size={previewSize === 'large' ? '3xl' : '2xl'} tabularNums />
                      <Col flex={1} minWidth={0} gap={1}>
                        <Text value={focus.metric} size="sm" color="secondary" />
                        <Caption value={labels.targetPrefix + focus.target} />
                      </Col>
                    </Row>
                    <Progress value={focus.done} max={focus.total} showValue={false} size="sm" color={palette.accent} />
                    <Col gap={1} padding={{ left: 3 }} border={{ left: { size: 2, color: palette.accent } }}>
                      <Caption value={labels.milestonePrefix + focus.nextDate} />
                      <Text value={focus.next} size="sm" weight="medium" />
                    </Col>
                    <Show when={previewSize === 'large'}><Caption value={focus.recent} /></Show>
                  </Col>
                  <Divider />
                  <Col gap={4}>
                    <Each of={displayedGoals.slice(1)} item="goal" index="i">
                      <Col key={goal.id} gap={2}>
                        <Row gap={3} align="start">
                          <Text value={goal.title} size="sm" weight="medium" />
                          <Spacer />
                          <Text value={String(round(goal.done / goal.total * 100)) + '%'} size="sm" tabularNums />
                        </Row>
                        <Progress value={goal.done} max={goal.total} showValue={false} size="sm" color={palette.accent} />
                        <Caption value={labels.targetPrefix + goal.target} />
                        <Text value={labels.nextPrefix + goal.next} size="sm" color="secondary" />
                        <Show when={previewSize === 'large'}><Caption value={goal.recent} /></Show>
                        <Show when={i < size(displayedGoals) - 2}><Divider color="subtle" spacing={1} /></Show>
                      </Col>
                    </Each>
                  </Col>
                </Show.Else>
              </Show>
            </Col>
          </Show>
        </Card>
      </Scope>
    </Scope>
    <Caption value={labels.sampleNote} />
  </Box>
</Basic>