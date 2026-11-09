<Scope values={{ nextReminder: items.find(item => !item.done) || items[0], completedCount: size(items.filter(item => item.done)) }}>
  <Scope values={{ featured: items.find(item => !item.done && item.priority === 'high') || nextReminder }}>
    <Basic align="center" gap={4}>
      <Col width="100%" maxWidth={400} gap={4}>
        <Col gap={3}>
          <Row justify="between" gap={3} wrap="wrap">
            <Col gap={1}>
              <Title value={labels.galleryTitle} size="sm" />
              <Caption value={labels.gallerySubtitle} />
            </Col>
            <Toggle bind="darkAppearance" label={labels.darkAppearance} variant="switch" />
          </Row>
          <Col gap={1}>
            <Label value={labels.direction} fieldName="direction" />
            <Select name="direction" bind="direction" options={directions} block size="2xl" />
          </Col>
          <SegmentedControl name="widgetSize" bind="widgetSize" options={sizes} ariaLabel={labels.sizeLabel} block size="xl" />
        </Col>
        <Box align="center" width="100%">
          <Box width="100%" maxWidth={widgetSize === 'small' ? 320 : 400}>
            <Scope values={{ visible: widgetSize === 'small' ? [direction === 'priority' ? featured : nextReminder] : widgetSize === 'medium' ? direction === 'grouped' ? items.filter(item => mediumGroupedIds.includes(item.id)) : items.slice(0, 5) : items }}>
              <Card size="full" padding={direction === 'editorial' ? 5 : 4} gap={direction === 'editorial' ? 5 : 4} theme={darkAppearance ? 'dark' : 'light'}>
                <Show when={direction === 'minimal'}>
                  <Row gap={2} align="center">
                    <Icon name="notebook" color="info" size="lg" />
                    <Text value={labels.reminders} weight="semibold" />
                    <Spacer />
                    <Caption value={String(completedCount) + ' / ' + String(size(items))} tabularNums />
                  </Row>
                  <Show when={widgetSize === 'small'}>
                    <Transition>
                      <Col key={nextReminder.id} gap={3}>
                        <Title value={nextReminder.title} size="lg" color={nextReminder.done ? 'secondary' : 'emphasis'} />
                        <Row gap={3} justify="between" align="center">
                          <Col gap={1}>
                            <Text value={nextReminder.dueLabel} size="sm" color="secondary" />
                            <Caption value={nextReminder.category} />
                          </Col>
                          <Button uniform size="2xl" variant="ghost" iconStart={nextReminder.done ? 'check-circle-filled' : 'empty-circle'} ariaLabel={(nextReminder.done ? labels.reopenPrefix : labels.completePrefix) + nextReminder.title} onClickAction={{ patchState: set('items.' + String(items.findIndex(item => item.id === nextReminder.id)) + '.done', !nextReminder.done) }} />
                        </Row>
                      </Col>
                    </Transition>
                    <Divider />
                    <Caption value={size(items.filter(item => !item.done && item.id !== nextReminder.id)) > 0 ? labels.thenPrefix + (items.find(item => !item.done && item.id !== nextReminder.id)).title : labels.nothingElse} />
                    <Show.Else>
                      <Col gap={3}>
                        <Each of={dayGroups} item="group">
                          <Show when={size(visible.filter(item => item.day === group.id)) > 0}>
                            <Col gap={2}>
                              <Show when={widgetSize === 'large'}>
                                <Row gap={3}>
                                  <Caption value={group.label} weight="semibold" />
                                  <Box flex={1}><Divider color="subtle" /></Box>
                                </Row>
                              </Show>
                              <Each of={visible.filter(item => item.day === group.id)} item="item">
                                <Col key={item.id} gap={1} padding={{ y: 1 }}>
                                  <Checkbox bind={'items.' + String(items.findIndex(task => task.id === item.id)) + '.done'} label={item.title} shape="circle" lineThrough />
                                  <Row padding={{ left: 6 }} gap={2} wrap="wrap">
                                    <Caption value={item.time} />
                                    <Show when={widgetSize === 'large'}><Caption value={item.category} /></Show>
                                    <Show when={widgetSize === 'large' && has(item.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={item.repeat} /></Show>
                                  </Row>
                                </Col>
                              </Each>
                            </Col>
                          </Show>
                        </Each>
                      </Col>
                    </Show.Else>
                  </Show>
                </Show>
                <Show when={direction === 'timeline'}>
                  <Col gap={1}>
                    <Caption value={labels.scheduleEyebrow} />
                    <Title value={widgetSize === 'small' ? labels.nextOnSchedule : labels.onYourSchedule} size="sm" />
                  </Col>
                  <Col gap={3}>
                    <Each of={dayGroups} item="group">
                      <Show when={size(visible.filter(item => item.day === group.id)) > 0}>
                        <Col gap={2}>
                          <Caption value={group.label} weight="semibold" />
                          <Col gap={0}>
                            <Each of={visible.filter(item => item.day === group.id)} item="item">
                              <Row key={item.id} align="stretch" gap={3}>
                                <Col width={66} minWidth={66} padding={{ top: 2 }} gap={1}>
                                  <Text value={item.time} size="sm" tabularNums color={item.done ? 'secondary' : 'primary'} />
                                  <Show when={item.id === nextReminder.id && !item.done}><Caption value={labels.next} color="info" /></Show>
                                </Col>
                                <Col flex={1} minWidth={0} border={{ left: { size: 1, color: 'subtle' } }} padding={{ left: 3, y: 2 }} gap={2}>
                                  <Checkbox bind={'items.' + String(items.findIndex(task => task.id === item.id)) + '.done'} label={item.title} shape="circle" lineThrough />
                                  <Row gap={2} wrap="wrap">
                                    <Caption value={item.category} />
                                    <Show when={has(item.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={item.repeat} /></Show>
                                  </Row>
                                </Col>
                              </Row>
                            </Each>
                          </Col>
                        </Col>
                      </Show>
                    </Each>
                  </Col>
                  <Show when={widgetSize === 'small'}><Caption value={String(completedCount) + ' of ' + String(size(items)) + labels.completeSuffix} /></Show>
                </Show>
                <Show when={direction === 'priority'}>
                  <Row gap={2} align="start">
                    <Icon name="flag" color="warning" size="lg" />
                    <Col gap={1} flex={1}>
                      <Title value={labels.needsAttention} size="sm" />
                      <Caption value={String(size(items.filter(item => !item.done && item.priority === 'high'))) + labels.prioritySuffix} />
                    </Col>
                  </Row>
                  <Col gap={4}>
                    <Each of={priorityGroups} item="group">
                      <Show when={size(visible.filter(item => (item.done ? 'done' : item.priority) === group.id)) > 0}>
                        <Col gap={2}>
                          <Show when={widgetSize !== 'small'}><Caption value={group.label} weight="semibold" color={group.id === 'high' ? 'warning' : 'secondary'} /></Show>
                          <Each of={visible.filter(item => (item.done ? 'done' : item.priority) === group.id)} item="item" index="i">
                            <Row key={item.id} gap={3} align="start" padding={{ y: 1 }}>
                              <Button uniform size="2xl" variant="ghost" color={group.id === 'high' ? 'warning' : 'secondary'} iconStart={item.done ? 'check-circle-filled' : 'empty-circle'} ariaLabel={(item.done ? labels.reopenPrefix : labels.completePrefix) + item.title} onClickAction={{ patchState: set('items.' + String(items.findIndex(task => task.id === item.id)) + '.done', !item.done) }} />
                              <Col flex={1} minWidth={0} gap={1} padding={{ top: 1 }}>
                                <Text value={item.title} size={widgetSize === 'small' || (group.id === 'high' && i === 0) ? 'xl' : 'sm'} weight={group.id === 'high' ? 'semibold' : 'normal'} color={item.done ? 'secondary' : 'emphasis'} lineThrough={item.done} />
                                <Text value={item.dueLabel} size="sm" color={group.id === 'high' ? 'warning' : 'secondary'} />
                                <Row gap={2} wrap="wrap">
                                  <Caption value={item.category} />
                                  <Show when={has(item.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={item.repeat} /></Show>
                                </Row>
                              </Col>
                            </Row>
                          </Each>
                        </Col>
                      </Show>
                    </Each>
                  </Col>
                  <Show when={widgetSize === 'small'}><Caption value={String(completedCount) + ' of ' + String(size(items)) + labels.completeSuffix} /></Show>
                </Show>
                <Show when={direction === 'grouped'}>
                  <Row align="baseline" gap={3} justify="between">
                    <Title value={labels.myReminders} size="sm" />
                    <Caption value={String(size(items.filter(item => !item.done))) + labels.openSuffix} />
                  </Row>
                  <Col gap={5}>
                    <Each of={dayGroups} item="group">
                      <Show when={size(visible.filter(item => item.day === group.id)) > 0}>
                        <Col gap={3}>
                          <Row align="baseline" gap={2}>
                            <Title value={group.label} size={widgetSize === 'small' ? 'md' : 'sm'} color={group.id === 'today' ? 'info' : 'emphasis'} />
                            <Text value={String(size(visible.filter(item => item.day === group.id)))} color="tertiary" size="sm" tabularNums />
                          </Row>
                          <Each of={visible.filter(item => item.day === group.id)} item="item">
                            <Col key={item.id} gap={1}>
                              <Checkbox bind={'items.' + String(items.findIndex(task => task.id === item.id)) + '.done'} label={item.title} shape="circle" lineThrough />
                              <Row gap={2} padding={{ left: 6 }} wrap="wrap">
                                <Text value={item.time} size="sm" color="secondary" />
                                <Caption value={item.category} />
                                <Show when={has(item.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={item.repeat} /></Show>
                              </Row>
                            </Col>
                          </Each>
                        </Col>
                      </Show>
                    </Each>
                  </Col>
                  <Show when={widgetSize === 'small'}>
                    <Divider color="subtle" />
                    <Caption value={labels.tomorrowPrefix + pluralize(size(items.filter(item => item.day === 'tomorrow' && !item.done)), 'reminder')} />
                  </Show>
                </Show>
                <Show when={direction === 'editorial'}>
                  <Transition>
                    <Col key={featured.id} gap={4}>
                      <Row gap={2} justify="between" align="center">
                        <Caption value={featured.done ? labels.allComplete : labels.nextImportant} weight="semibold" />
                        <Icon name="notebook-pencil" size="md" color="secondary" />
                      </Row>
                      <Title value={featured.title} size={widgetSize === 'small' ? 'lg' : '2xl'} color={featured.done ? 'secondary' : 'emphasis'} />
                      <Row justify="between" gap={3}>
                        <Col gap={1}>
                          <Text value={featured.dueLabel} size="sm" weight="medium" />
                          <Row gap={2} wrap="wrap">
                            <Caption value={featured.category} />
                            <Show when={has(featured.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={featured.repeat} /></Show>
                          </Row>
                        </Col>
                        <Button uniform size="3xl" variant="outline" iconStart={featured.done ? 'check-circle-filled' : 'empty-circle'} ariaLabel={(featured.done ? labels.reopenPrefix : labels.completePrefix) + featured.title} onClickAction={{ patchState: set('items.' + String(items.findIndex(item => item.id === featured.id)) + '.done', !featured.done) }} />
                      </Row>
                    </Col>
                  </Transition>
                  <Show when={widgetSize !== 'small'}>
                    <Divider color="subtle" />
                    <Scope values={{ supporting: items.filter(item => item.id !== featured.id).slice(0, widgetSize === 'medium' ? 4 : 8) }}>
                      <Col gap={3}>
                        <Each of={dayGroups} item="group">
                          <Show when={size(supporting.filter(item => item.day === group.id)) > 0}>
                            <Col gap={3}>
                              <Caption value={widgetSize === 'medium' ? labels.alsoOnYourList : group.label} weight="semibold" />
                              <Each of={supporting.filter(item => item.day === group.id)} item="item">
                                <Col key={item.id} gap={1}>
                                  <Checkbox bind={'items.' + String(items.findIndex(task => task.id === item.id)) + '.done'} label={item.title} shape="circle" lineThrough />
                                  <Row padding={{ left: 6 }} gap={2} wrap="wrap">
                                    <Caption value={item.time} />
                                    <Caption value={item.category} />
                                    <Show when={has(item.repeat)}><Icon name="repeat" size="xs" color="secondary" /><Caption value={item.repeat} /></Show>
                                  </Row>
                                </Col>
                              </Each>
                            </Col>
                          </Show>
                        </Each>
                      </Col>
                    </Scope>
                    <Show.Else><Caption value={String(completedCount) + ' of ' + String(size(items)) + labels.completeSuffix} /></Show.Else>
                  </Show>
                </Show>
                <Show when={widgetSize === 'large'}>
                  <Divider color="subtle" />
                  <Row gap={3} justify="between" wrap="wrap">
                    <Caption value={labels.tomorrowPrefix + String(size(items.filter(item => item.day === 'tomorrow' && !item.done))) + labels.openSuffix} />
                    <Caption value={labels.laterPrefix + String(size(items.filter(item => item.day === 'later' && !item.done))) + labels.openSuffix} />
                  </Row>
                </Show>
              </Card>
            </Scope>
          </Box>
        </Box>
        <Caption value={labels.sampleNote} textAlign="center" />
      </Col>
    </Basic>
  </Scope>
</Scope>