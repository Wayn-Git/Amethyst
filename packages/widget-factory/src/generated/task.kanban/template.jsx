<Basic theme={darkMode ? 'dark' : 'light'} gap={3}>
  <Box width="100%" maxWidth={440} gap={3}>
    <Row gap={3}>
      <Col gap={1} flex={1} minWidth={0}>
        <Title value={ui.title} size="sm" />
        <Caption value={ui.subtitle} />
      </Col>
      <Show when={moves > 0}>
        <Button label={ui.reset} variant="ghost" size="xl" $onClickAction='{ patchState: projects.map((p, pi) => p.tasks.map((task, ti) => set("projects." + String(pi) + ".tasks." + String(ti) + ".stage", task.initialStage))).flat(1), updateState: { moves: 0 } }' />
      </Show>
      <Button uniform variant="ghost" size="2xl" iconStart={darkMode ? 'sun' : 'moon'} ariaLabel={darkMode ? ui.lightAppearance : ui.darkAppearance} $onClickAction='{ updateState: { darkMode: !darkMode } }' />
    </Row>
    <SegmentedControl name="sizeChoice" bind="sizeChoice" options={sizeOptions} ariaLabel={ui.sizeLabel} block size="2xl" />
    <SegmentedControl key={sizeChoice} name="variation" bind={sizeChoice + 'Variant'} options={variations[sizeChoice]} ariaLabel={ui.variationLabel} size="xl" />
    <Scope values={{ projectIndex: projects.findIndex(p => p.id === projectChoice) }}>
      <Scope values={{ project: projects[projectIndex] }}>
        <Scope values={{ completed: size(project.tasks.filter(task => task.stage === 'done')), nextTask: sortBy(project.tasks.filter(task => task.stage !== 'done'), 'rank')[0] || null, compactTasks: project.tasks.filter(task => task.stage !== 'review') }}>
          <Card size={sizeChoice === 'small' ? 'sm' : 'md'} width={sizeChoice === 'small' ? 'min(100%, 360px)' : '100%'} padding={4} gap={4} theme={darkMode ? 'dark' : 'light'}>
            <Show when={sizeChoice === 'small'}>
              <Show when={smallVariant === 'minimal'}>
                <Col gap={1}>
                  <Title value={project.name} size="sm" />
                  <Caption value={ui.snapshot} />
                </Col>
                <Grid columns={4} gap={2}>
                  <Each of={stages} item="stage">
                    <Col key={stage.id} gap={1}>
                      <Text value={String(size(project.tasks.filter(task => task.stage === stage.id)))} size="xl" weight="semibold" tabularNums />
                      <Caption value={stage.short} />
                    </Col>
                  </Each>
                </Grid>
                <Divider />
                <Show when={nextTask !== null}>
                  <Col gap={2}>
                    <Caption value={ui.upNext} />
                    <Text value={nextTask.title} size="sm" weight="medium" />
                    <Row gap={2} wrap="wrap">
                      <Text value={nextTask.priority} size="xs" weight="medium" color={nextTask.tone} />
                      <Caption value={ui.duePrefix + nextTask.due} />
                    </Row>
                  </Col>
                  <Show.Else><EmptyState icon="check-circle" title={ui.allDone} description={ui.allDoneNote} padding={2} /></Show.Else>
                </Show>
                <Show.Else>
                  <Col gap={1}>
                    <Title value={project.name} size="sm" />
                    <Caption value={ui.snapshot} />
                  </Col>
                  <Show when={nextTask !== null}>
                    <Scope values={{ currentStage: stages.find(stage => stage.id === nextTask.stage) }}>
                      <Col gap={3}>
                        <Row gap={2} wrap="wrap">
                          <Badge label={nextTask.priority} color={nextTask.priority === 'Urgent' ? 'danger' : 'secondary'} size="sm" />
                          <Caption value={currentStage.label} />
                        </Row>
                        <Text value={nextTask.title} size="lg" weight="semibold" />
                        <Text value={nextTask.owner + ' · ' + ui.duePrefix + nextTask.due} size="sm" color="secondary" />
                        <Button label={currentStage.actionLabel} iconEnd="arrow-right" color="primary" size="2xl" block $onClickAction='{ patchState: set("projects." + String(projectIndex) + ".tasks." + String(project.tasks.findIndex(task => task.id === nextTask.id)) + ".stage", currentStage.next), updateState: { moves: moves + 1 } }' />
                      </Col>
                    </Scope>
                    <Show.Else><EmptyState icon="check-circle" title={ui.allDone} description={ui.allDoneNote} padding={2} /></Show.Else>
                  </Show>
                  <Divider />
                  <Grid columns={4} gap={2}>
                    <Each of={stages} item="stage">
                      <Col key={stage.id} gap={1}>
                        <Caption value={stage.short} />
                        <Text value={String(size(project.tasks.filter(task => task.stage === stage.id)))} size="sm" weight="semibold" tabularNums />
                      </Col>
                    </Each>
                  </Grid>
                  <Caption value={ui.localNote} />
                </Show.Else>
              </Show>
            </Show>
            <Show when={sizeChoice === 'medium'}>
              <Show when={mediumVariant === 'board'}>
                <Col gap={1}>
                  <Title value={project.name} size="sm" />
                  <Caption value={ui.snapshot} />
                </Col>
                <Grid columns="repeat(auto-fit, minmax(min(100%, 100px), 1fr))" gap={2}>
                  <Each of={stages.filter(stage => stage.id !== 'review')} item="stage">
                    <Scope values={{ laneTasks: project.tasks.filter(task => task.stage === stage.id) }}>
                      <Col key={stage.id} background="surface-secondary" radius="md" padding={2} gap={3}>
                        <Row gap={1} align="start">
                          <Text value={stage.label} size="xs" weight="semibold" />
                          <Spacer />
                          <Text value={String(size(laneTasks))} size="xs" color="secondary" tabularNums />
                        </Row>
                        <Show when={size(laneTasks) > 0}>
                          <Each of={laneTasks} item="task">
                            <Box key={task.id} background="surface-elevated" radius="sm" padding={2} gap={2}>
                              <Text value={task.title} size="sm" weight="medium" />
                              <Row gap={1} wrap="wrap">
                                <Icon name={stage.icon} size="xs" color={stage.color} />
                                <Text value={task.priority} size="xs" color={task.tone} />
                              </Row>
                            </Box>
                          </Each>
                          <Show.Else><Caption value={ui.emptyLane} /></Show.Else>
                        </Show>
                      </Col>
                    </Scope>
                  </Each>
                </Grid>
                <Show.Else>
                  <Col gap={3}>
                    <Col gap={1}>
                      <Caption value={ui.projectLabel} />
                      <Title value={project.name} size="sm" />
                    </Col>
                    <Col gap={2}>
                      <Label value={ui.chooseProject} fieldName="projectChoice" />
                      <Select name="projectChoice" bind="projectChoice" options={projects.map(p => ({ label: p.name, value: p.id }))} block size="2xl" />
                    </Col>
                    <Caption value={ui.snapshot} />
                  </Col>
                  <Each of={stages.filter(stage => stage.id !== 'review')} item="stage">
                    <Scope values={{ laneTasks: project.tasks.filter(task => task.stage === stage.id) }}>
                      <Col key={stage.id} gap={2}>
                        <Row gap={2}>
                          <Icon name={stage.icon} size="sm" color={stage.color} />
                          <Text value={stage.label} size="sm" weight="semibold" />
                          <Text value={String(size(laneTasks))} size="xs" color="secondary" tabularNums />
                        </Row>
                        <Divider color="subtle" />
                        <Show when={size(laneTasks) > 0}>
                          <Each of={laneTasks} item="task">
                            <Row key={task.id} gap={3} padding={{ y: 1 }} align="start">
                              <Text value={task.title} size="sm" flex={1} width="100%" />
                              <Text value={task.priority} size="xs" color={task.tone} />
                            </Row>
                          </Each>
                          <Show.Else><Caption value={ui.emptyLane} /></Show.Else>
                        </Show>
                      </Col>
                    </Scope>
                  </Each>
                </Show.Else>
              </Show>
              <Divider />
              <Col gap={2}>
                <Text value={String(size(compactTasks)) + ui.previewSuffix + String(size(project.tasks.filter(task => task.stage === 'review'))) + ui.reviewSuffix} size="xs" color="secondary" />
                <Row>
                  <Button label={ui.fullBoard} iconEnd="arrow-up-right" variant="ghost" size="xl" onClickAction={{ updateState: { sizeChoice: 'large', largeVariant: 'board' } }} />
                </Row>
              </Col>
            </Show>
            <Show when={sizeChoice === 'large'}>
              <Show when={largeVariant === 'board'}>
                <Col gap={3}>
                  <Col gap={1}>
                    <Title value={project.name} size="sm" />
                    <Caption value={ui.snapshot} />
                  </Col>
                  <Row justify="between" gap={2} wrap="wrap">
                    <Text value={String(completed) + ui.of + String(size(project.tasks)) + ui.doneSuffix} size="sm" color="secondary" />
                    <Text value={format(completed / size(project.tasks), 'percent', { digits: 0 })} size="sm" weight="semibold" tabularNums />
                  </Row>
                  <Progress value={completed} max={size(project.tasks)} showValue={false} color="secondary" size="sm" />
                </Col>
                <Grid columns="repeat(auto-fit, minmax(min(100%, 164px), 1fr))" gap={4}>
                  <Each of={stages} item="stage">
                    <Scope values={{ laneTasks: project.tasks.filter(task => task.stage === stage.id) }}>
                      <Col key={stage.id} gap={3}>
                        <Row gap={2}>
                          <Icon name={stage.icon} size="sm" color={stage.color} />
                          <Text value={stage.label} size="sm" weight="semibold" />
                          <Spacer />
                          <Text value={String(size(laneTasks))} size="xs" color="secondary" tabularNums />
                        </Row>
                        <Divider color="subtle" />
                        <Show when={size(laneTasks) > 0}>
                          <Each of={laneTasks} item="task">
                            <Box key={task.id} background="surface-secondary" radius="sm" padding={3} gap={2}>
                              <Text value={task.title} size="sm" weight="medium" />
                              <Caption value={task.owner + ' · ' + task.due} />
                              <Text value={task.priority} size="xs" color={task.tone} />
                            </Box>
                          </Each>
                          <Show.Else><Caption value={ui.emptyLane} /></Show.Else>
                        </Show>
                      </Col>
                    </Scope>
                  </Each>
                </Grid>
                <Show.Else>
                  <Col gap={1}>
                    <Caption value={ui.progressEyebrow} />
                    <Title value={project.name} size="sm" />
                    <Caption value={ui.snapshot} />
                  </Col>
                  <Row gap={5} align="end" wrap="wrap">
                    <Stat label={ui.completion} value={format(completed / size(project.tasks), 'percent', { digits: 0 })} size="lg" />
                    <Col gap={1} padding={{ bottom: 1 }}>
                      <Text value={String(completed) + ui.of + String(size(project.tasks)) + ui.doneSuffix} size="sm" />
                      <Caption value={String(size(project.tasks) - completed) + ui.remainingSuffix} />
                    </Col>
                  </Row>
                  <Progress value={completed} max={size(project.tasks)} showValue={false} color="secondary" size="sm" />
                  <Show when={nextTask !== null}>
                    <Scope values={{ currentStage: stages.find(stage => stage.id === nextTask.stage) }}>
                      <Box padding={3} radius="md" background="surface-secondary" gap={2}>
                        <Caption value={ui.nextMove} />
                        <Text value={nextTask.title} size="sm" weight="medium" />
                        <Row gap={2} wrap="wrap">
                          <Text value={currentStage.label + ' → ' + stages.find(stage => stage.id === currentStage.next).label} size="xs" color="secondary" />
                          <Spacer />
                          <Button label={currentStage.actionLabel} iconEnd="arrow-right" size="2xl" color="primary" $onClickAction='{ patchState: set("projects." + String(projectIndex) + ".tasks." + String(project.tasks.findIndex(task => task.id === nextTask.id)) + ".stage", currentStage.next), updateState: { moves: moves + 1 } }' />
                        </Row>
                      </Box>
                    </Scope>
                    <Show.Else><Text value={ui.allDoneNote} size="sm" /></Show.Else>
                  </Show>
                  <Each of={stages} item="stage" index="stageIndex">
                    <Scope values={{ laneTasks: project.tasks.filter(task => task.stage === stage.id) }}>
                      <Col key={stage.id} gap={2}>
                        <Row gap={2}>
                          <Text value={String(stageIndex + 1).padStart(2, '0')} size="xs" color="secondary" tabularNums />
                          <Text value={stage.label} size="sm" weight="semibold" />
                          <Spacer />
                          <Text value={pluralize(size(laneTasks), 'task')} size="xs" color="secondary" />
                        </Row>
                        <Divider color="subtle" />
                        <Show when={size(laneTasks) > 0}>
                          <Each of={laneTasks} item="task">
                            <Row key={task.id} gap={3} padding={{ y: 1 }} align="start">
                              <Col flex={1} minWidth={0} gap={1}>
                                <Text value={task.title} size="sm" weight="medium" />
                                <Caption value={task.owner + ' · ' + ui.duePrefix + task.due} />
                              </Col>
                              <Text value={task.priority} size="xs" color={task.tone} />
                            </Row>
                          </Each>
                          <Show.Else><Caption value={ui.emptyLane} /></Show.Else>
                        </Show>
                      </Col>
                    </Scope>
                  </Each>
                  <Caption value={ui.localNote} />
                </Show.Else>
              </Show>
            </Show>
          </Card>
        </Scope>
      </Scope>
    </Scope>
  </Box>
</Basic>