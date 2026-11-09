<Scope values={{ currentView: variantBySize[sizeChoice], recommended: tasks.find(task => task.id === recommendedId) || tasks[0], urgentCount: size(tasks.filter(task => task.priority === 'Urgent')), blockedCount: size(tasks.filter(task => task.status === 'Blocked')), oldestTasks: sortBy(tasks, 'age', 'desc'), mediumCount: size(tasks.filter(task => mediumTaskIds.includes(task.id))) }}>
  <Basic gap={3} align="start">
    <Box width="100%" maxWidth={sizeChoice === 'large' && currentView === 'split' ? 560 : 400} gap={3}>
      <Row gap={3}>
        <Col gap={0} flex={1} minWidth={0}>
          <Text value={labels.studies} size="sm" weight="semibold" />
          <Caption value={labels.sampleNote} size="sm" />
        </Col>
        <Button label={appearance === 'light' ? labels.dark : labels.light} ariaLabel={appearance === 'light' ? labels.switchDark : labels.switchLight} iconStart={appearance === 'light' ? 'moon' : 'sun'} variant="ghost" size="2xl" onClickAction={{ updateState: { appearance: appearance === 'light' ? 'dark' : 'light' } }} />
      </Row>
      <SegmentedControl name="sizeChoice" bind="sizeChoice" options={sizes} ariaLabel={labels.sizeLabel} block size="2xl" />
      <SegmentedControl key={sizeChoice} name="layoutChoice" bind={`variantBySize.${sizeChoice}`} options={directions[sizeChoice]} ariaLabel={labels.directionLabel} size="xl" />
      <Card size="full" width="100%" theme={appearance} padding={4} gap={4}>
        <Show when={size(tasks) > 0}>
          <Show when={sizeChoice === 'small' && currentView === 'minimal'}>
            <Col gap={3}>
              <Row gap={2}>
                <Text value={labels.backlog} size="sm" weight="medium" />
                <Spacer />
                <Row gap={1}>
                  <Box size={5} radius="full" background="danger" />
                  <Text value={String(urgentCount) + labels.urgentSuffix} size="xs" color="danger" />
                </Row>
              </Row>
              <Row align="baseline" gap={3}>
                <Title value={String(size(tasks))} size="5xl" tabularNums />
                <Text value={labels.waiting} size="sm" color="secondary" />
              </Row>
              <Divider color="subtle" />
              <Col gap={1}>
                <Caption value={labels.nextUp} size="sm" />
                <Text value={recommended.title} size="sm" weight="medium" />
                <Caption value={recommended.project + ' · ' + String(recommended.age) + labels.daysWaitingSuffix} />
              </Col>
            </Col>
          </Show>
          <Show when={sizeChoice === 'small' && currentView === 'editorial'}>
            <Col gap={4}>
              <Row gap={2} align="start">
                <Row gap={1}>
                  <Icon name="arrow-up-right" size="sm" color="info" />
                  <Text value={labels.nextUp} size="xs" color="info" weight="medium" />
                </Row>
                <Spacer />
                <Caption value={String(size(tasks)) + labels.waitingSuffix} size="sm" />
              </Row>
              <Col gap={2}>
                <Title value={recommended.title} size="md" />
                <Text value={recommendationReason} size="sm" color="secondary" />
              </Col>
              <Row gap={2} wrap="wrap">
                <Text value={recommended.priority} size="xs" color="danger" weight="medium" />
                <Caption value={recommended.project + ' · ' + String(recommended.age) + labels.daySuffix} />
              </Row>
            </Col>
          </Show>
          <Show when={sizeChoice === 'medium' && currentView === 'priority'}>
            <Col gap={4}>
              <Col gap={1}>
                <Row align="baseline" gap={3}>
                  <Title value={labels.backlog} size="sm" />
                  <Spacer />
                  <Title value={String(size(tasks))} size="2xl" tabularNums />
                </Row>
                <Caption value={String(urgentCount) + labels.urgentSuffix + ' · ' + String(blockedCount) + labels.blockedSuffix} />
              </Col>
              <Each of={mediumSections} item="section">
                <Scope values={{ sectionTasks: tasks.filter(task => section.ids.includes(task.id)) }}>
                  <Col gap={1}>
                    <Row gap={2}>
                      <Text value={section.title} size="xs" weight="semibold" color={section.attention ? 'danger' : 'secondary'} />
                      <Spacer />
                      <Caption value={String(size(sectionTasks))} size="sm" tabularNums />
                    </Row>
                    <Each of={sectionTasks} item="task" index="i">
                      <Show when={i > 0}><Divider color="subtle" /></Show>
                      <Row key={task.id} gap={3} align="start" padding={{ y: 2 }}>
                        <Col flex={1} minWidth={0} gap={1}>
                          <Text value={task.title} size="sm" weight="medium" />
                          <Row gap={2} wrap="wrap">
                            <Caption value={task.project} size="sm" />
                            <Caption value={String(task.age) + labels.daySuffix} size="sm" color={task.age >= 21 ? 'warning' : 'secondary'} />
                            <Show when={task.status === 'Blocked'}><Caption value={task.status} size="sm" /></Show>
                          </Row>
                        </Col>
                        <Text value={task.priority} size="xs" color={task.priority === 'Urgent' ? 'danger' : 'secondary'} />
                      </Row>
                    </Each>
                  </Col>
                </Scope>
              </Each>
              <Caption value={labels.showingPrefix + String(mediumCount) + labels.of + String(size(tasks))} size="sm" />
            </Col>
          </Show>
          <Show when={sizeChoice === 'medium' && currentView === 'timeline'}>
            <Col gap={3}>
              <Col gap={1}>
                <Title value={labels.waitingLongest} size="sm" />
                <Caption value={String(size(tasks)) + labels.waitingSuffix + ' · ' + String(urgentCount) + labels.urgentSuffix} />
              </Col>
              <Col gap={0}>
                <Each of={oldestTasks.slice(0, 6)} item="task" index="i">
                  <Show when={i > 0}><Divider color="subtle" /></Show>
                  <Row key={task.id} gap={3} align="start" padding={{ y: 3 }}>
                    <Box width={38} minWidth={38}>
                      <Text value={String(task.age) + labels.daySuffix} size="sm" tabularNums weight="medium" color={task.age >= 21 ? 'warning' : 'secondary'} />
                    </Box>
                    <Col flex={1} minWidth={0} gap={1}>
                      <Text value={task.title} size="sm" weight="medium" />
                      <Row gap={2} wrap="wrap">
                        <Caption value={task.project} size="sm" />
                        <Text value={task.priority} size="xs" color={task.priority === 'Urgent' ? 'danger' : 'secondary'} />
                        <Show when={task.status === 'Blocked'}><Caption value={task.status} size="sm" /></Show>
                      </Row>
                    </Col>
                  </Row>
                </Each>
              </Col>
              <Col gap={1}>
                <Text value={labels.timelineNote} size="sm" color="secondary" />
                <Caption value={labels.showingPrefix + String(min(6, size(tasks))) + labels.of + String(size(tasks))} size="sm" />
              </Col>
            </Col>
          </Show>
          <Show when={sizeChoice === 'large' && currentView === 'grouped'}>
            <Col gap={4}>
              <Col gap={2}>
                <Title value={labels.backlog} size="sm" />
                <Row align="center" gap={3}>
                  <Row align="baseline" gap={2}>
                    <Title value={String(size(tasks))} size="3xl" tabularNums />
                    <Caption value={labels.waiting} />
                  </Row>
                  <Spacer />
                  <Col gap={1} align="end">
                    <Text value={String(urgentCount) + labels.urgentSuffix} size="xs" color="danger" />
                    <Caption value={String(blockedCount) + labels.blockedSuffix} size="sm" />
                  </Col>
                </Row>
                <Text value={labels.groupedAttention} size="sm" color="info" />
              </Col>
              <Each of={projects} item="project" index="projectIndex">
                <Scope values={{ projectTasks: tasks.filter(task => task.project === project.name) }}>
                  <Show when={size(projectTasks) > 0}>
                    <Show when={projectIndex > 0}><Divider color="subtle" /></Show>
                    <Col gap={1}>
                      <Row gap={2}>
                        <Text value={project.name} size="sm" weight="semibold" />
                        <Spacer />
                        <Caption value={String(size(projectTasks))} size="sm" tabularNums />
                      </Row>
                      <Each of={projectTasks} item="task" index="i">
                        <Show when={i > 0}><Divider color="subtle" /></Show>
                        <Col key={task.id} gap={1} padding={{ y: 2 }}>
                          <Row gap={2} align="start">
                            <Show when={task.id === recommendedId}><Icon name="arrow-right" size="sm" color="info" /></Show>
                            <Col flex={1} minWidth={0}>
                              <Text value={task.title} size="sm" weight="medium" color={task.id === recommendedId ? 'info' : 'primary'} />
                            </Col>
                          </Row>
                          <Row gap={2} wrap="wrap">
                            <Text value={task.priority} size="xs" color={task.priority === 'Urgent' ? 'danger' : 'secondary'} />
                            <Caption value={task.status} size="sm" />
                            <Caption value={String(task.age) + labels.daysWaitingSuffix} size="sm" color={task.age >= 21 ? 'warning' : 'secondary'} />
                          </Row>
                        </Col>
                      </Each>
                    </Col>
                  </Show>
                </Scope>
              </Each>
              <Caption value={labels.ageNote} size="sm" />
            </Col>
          </Show>
          <Show when={sizeChoice === 'large' && currentView === 'split'}>
            <Col gap={4}>
              <Col gap={1}>
                <Row gap={2} align="baseline" wrap="wrap">
                  <Title value={labels.backlog} size="sm" />
                  <Spacer />
                  <Text value={String(size(tasks)) + labels.waitingSuffix} size="sm" color="secondary" tabularNums />
                </Row>
                <Caption value={String(urgentCount) + labels.urgentSuffix + ' · ' + String(blockedCount) + labels.blockedSuffix} size="sm" />
              </Col>
              <Box background="surface-secondary" padding={4} radius="md" gap={3}>
                <Row gap={2}>
                  <Icon name="arrow-up-right" size="sm" color="info" />
                  <Text value={labels.recommendedFirst} size="xs" color="info" weight="medium" />
                </Row>
                <Col gap={2}>
                  <Title value={recommended.title} size="md" />
                  <Text value={recommendationReason} size="sm" color="secondary" />
                </Col>
                <Row gap={2} wrap="wrap">
                  <Text value={recommended.priority} size="xs" color="danger" />
                  <Caption value={recommended.project + ' · ' + recommended.status + ' · ' + String(recommended.age) + labels.daySuffix} size="sm" />
                </Row>
              </Box>
              <Grid columns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))" gap={5}>
                <Each of={splitSections} item="section">
                  <Scope values={{ sectionTasks: tasks.filter(task => task.id !== recommendedId && section.priorities.includes(task.priority)) }}>
                    <Col gap={2}>
                      <Row gap={2}>
                        <Text value={section.title} size="xs" weight="semibold" />
                        <Spacer />
                        <Caption value={String(size(sectionTasks))} size="sm" tabularNums />
                      </Row>
                      <Col gap={0}>
                        <Each of={sectionTasks} item="task" index="i">
                          <Show when={i > 0}><Divider color="subtle" /></Show>
                          <Col key={task.id} gap={1} padding={{ y: 2 }}>
                            <Text value={task.title} size="sm" weight="medium" />
                            <Caption value={task.project + ' · ' + task.status} size="sm" />
                            <Row gap={2} wrap="wrap">
                              <Text value={task.priority} size="xs" color={task.priority === 'Urgent' ? 'danger' : 'secondary'} />
                              <Caption value={String(task.age) + labels.daysWaitingSuffix} size="sm" color={task.age >= 21 ? 'warning' : 'secondary'} />
                            </Row>
                          </Col>
                        </Each>
                      </Col>
                    </Col>
                  </Scope>
                </Each>
              </Grid>
              <Caption value={labels.ageNote} size="sm" />
            </Col>
          </Show>
          <Show.Else><EmptyState icon="check-circle" title={labels.emptyTitle} description={labels.emptyDescription} /></Show.Else>
        </Show>
      </Card>
    </Box>
  </Basic>
</Scope>