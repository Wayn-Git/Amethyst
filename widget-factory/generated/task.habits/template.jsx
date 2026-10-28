<Scope values={{ entries: habits.map((habit, index) => ({ id: habit.id, title: habit.title, shortName: habit.shortName, period: habit.period, done: habit.done, week: habit.week, current: habit.streakBefore + Number(habit.done), best: max(habit.bestBefore, habit.streakBefore + Number(habit.done)), completed: sum(habit.week), index: index })) }}>
  <Scope values={{ leader: sortBy(entries, 'current', 'desc')[0], featured: entries.find(habit => habit.id === 'read'), todayCount: size(entries.filter(habit => habit.done)), weeklyCount: sum(entries, 'completed'), weeklyTotal: size(entries) * size(days), checklist: entries.slice(0, 4), grouped: entries.filter(habit => groupedIds.includes(habit.id)) }}>
    <Basic theme={appearance} align="center" gap={4}>
      <Box width="100%" maxWidth={400} gap={5}>
        <Col gap={3}>
          <Col gap={1}>
            <Title value={labels.title} size="md" />
            <Text value={labels.intro} size="sm" color="secondary" />
            <Caption value={labels.sampleDate} />
          </Col>
          <SegmentedControl name="appearance" bind="appearance" ariaLabel={labels.appearance} options={appearances} size="2xl" />
        </Col>

        <Grid columns="repeat(auto-fit, minmax(min(100%, 180px), 1fr))" gap={3}>
          <Col gap={2}>
            <Caption value={labels.smallMinimal} size="sm" />
            <Card size="full" theme={appearance} padding={4} gap={3}>
              <Caption value={labels.today} />
              <Row align="baseline" gap={2}>
                <Transition><Title key={String(todayCount)} value={String(todayCount)} size="3xl" tabularNums /></Transition>
                <Text value={'/ ' + String(size(entries))} size="xl" color="secondary" tabularNums />
              </Row>
              <Text value={labels.habitsComplete} size="sm" color="secondary" />
              <Row gap={2} wrap="wrap">
                <Icon name="flame" color="success" size="sm" />
                <Caption value={leader.shortName + ' · ' + String(leader.current) + labels.streakSuffix} />
              </Row>
            </Card>
          </Col>
          <Col gap={2}>
            <Caption value={labels.smallEditorial} size="sm" />
            <Card size="full" theme={appearance} padding={4} gap={3}>
              <Caption value={featured.done ? labels.doneToday : labels.needsAttention} />
              <Title value={featured.title} size="md" />
              <Text value={String(featured.current) + labels.currentStreakSuffix} size="sm" color="secondary" />
              <Spacer minSize={1} />
              <Checkbox name="featuredHabit" bind={'habits.' + String(featured.index) + '.done'} label={featured.done ? labels.completed : labels.markDone} shape="circle" />
            </Card>
          </Col>
        </Grid>

        <Col gap={2}>
          <Caption value={labels.mediumMinimal} size="sm" />
          <Card size="full" theme={appearance} padding={4} gap={3}>
            <Row align="start" gap={3}>
              <Col gap={1} flex={1} minWidth={0}>
                <Title value={labels.dailyEssentials} size="sm" />
                <Caption value={labels.checklistDescription} />
              </Col>
              <Text value={String(size(checklist.filter(habit => habit.done))) + ' / ' + String(size(checklist))} weight="semibold" tabularNums />
            </Row>
            <Progress value={size(checklist.filter(habit => habit.done))} max={size(checklist)} label={labels.todayProgress} showValue={false} color="success" size="sm" />
            <Col gap={0}>
              <Row gap={2}><Caption value={labels.habit} /><Spacer /><Caption value={labels.currentStreak} /></Row>
              <Each of={checklist} item="habit" index="i">
                <Row key={habit.id} gap={3} minHeight={48}>
                  <Col flex={1} minWidth={0}>
                    <Checkbox name={'checklist-' + habit.id} bind={'habits.' + String(habit.index) + '.done'} label={habit.title} shape="circle" />
                  </Col>
                  <Text value={String(habit.current) + 'd'} size="sm" color="secondary" tabularNums />
                </Row>
                <Show when={i < size(checklist) - 1}><Divider color="subtle" /></Show>
              </Each>
            </Col>
          </Card>
        </Col>

        <Col gap={2}>
          <Caption value={labels.mediumGrouped} size="sm" />
          <Card size="full" theme={appearance} padding={4} gap={4}>
            <Col gap={1}>
              <Title value={labels.dailyRhythm} size="sm" />
              <Caption value={String(size(grouped.filter(habit => habit.done))) + ' of ' + String(size(grouped)) + labels.doneSuffix} />
            </Col>
            <Each of={periods} item="period">
              <Col key={period.id} gap={1}>
                <Row gap={2}>
                  <Icon name={period.icon} size="sm" color="secondary" />
                  <Caption value={period.label} weight="medium" />
                </Row>
                <Each of={grouped.filter(habit => habit.period === period.id)} item="habit">
                  <Row key={habit.id} gap={3} minHeight={44}>
                    <Col flex={1} minWidth={0}>
                      <Checkbox name={'grouped-' + habit.id} bind={'habits.' + String(habit.index) + '.done'} label={habit.title} shape="circle" />
                    </Col>
                    <Caption value={String(habit.current) + 'd'} tabularNums />
                  </Row>
                </Each>
              </Col>
            </Each>
            <Progress value={size(grouped.filter(habit => habit.done))} max={size(grouped)} label={labels.todayProgress} showValue={false} color="success" size="sm" />
          </Card>
        </Col>

        <Col gap={2}>
          <Caption value={labels.largeCalendar} size="sm" />
          <Card size="full" theme={appearance} padding={4} gap={3}>
            <Col gap={1}>
              <Title value={labels.weekInView} size="sm" />
              <Text value={labels.weekPeriod} size="sm" color="secondary" />
              <Caption value={labels.historyScope} />
            </Col>
            <Grid columns={7} gap={1}>
              <Each of={days} item="day"><Caption key={day.index} value={day.short} textAlign="center" size="sm" /></Each>
            </Grid>
            <Each of={entries} item="habit">
              <Col key={habit.id} gap={1}>
                <Row gap={2} align="baseline">
                  <Col flex={1} minWidth={0}><Text value={habit.title} size="sm" weight="medium" /></Col>
                  <Caption value={String(habit.current) + labels.currentShort} tabularNums />
                </Row>
                <Grid columns={7} gap={1}>
                  <Each of={days} item="day">
                    <Box key={day.index} height={24} radius="xs" background={habit.week[day.index] === 1 ? completeSurface : 'surface-secondary'} align="center" justify="center">
                      <Svg size={14} title={day.label + ': ' + (habit.week[day.index] === 1 ? labels.completed : labels.missed)} paths={marks[appearance][habit.week[day.index] === 1 ? 'done' : 'missed']} />
                    </Box>
                  </Each>
                </Grid>
                <Caption value={format(habit.completed / size(days), 'percent', { digits: 0 }) + labels.completionSeparator + String(size(days) - habit.completed) + labels.missedSuffix} size="sm" />
              </Col>
            </Each>
            <Divider />
            <Row gap={4} align="baseline" wrap="wrap">
              <Text value={String(weeklyCount) + ' / ' + String(weeklyTotal)} weight="semibold" size="xl" tabularNums />
              <Text value={format(weeklyCount / weeklyTotal, 'percent', { digits: 0 }) + labels.completeSuffix} size="sm" />
            </Row>
            <Caption value={labels.lastWeekSummary + String(weeklyTotal - weeklyCount) + labels.missedHabitDays} />
            <Row gap={3} wrap="wrap">
              <Row gap={1}><Svg size={13} title={labels.completed} paths={marks[appearance].done} /><Caption value={labels.completed} size="sm" /></Row>
              <Row gap={1}><Svg size={13} title={labels.missed} paths={marks[appearance].missed} /><Caption value={labels.missed} size="sm" /></Row>
            </Row>
          </Card>
        </Col>

        <Col gap={2}>
          <Caption value={labels.largeStreaks} size="sm" />
          <Card size="full" theme={appearance} padding={4} gap={4}>
            <Col gap={2}>
              <Caption value={labels.longestCurrent} />
              <Title value={leader.title} size="sm" />
              <Row align="end" gap={6} wrap="wrap">
                <Col gap={0}>
                  <Title value={String(leader.current)} size="4xl" tabularNums />
                  <Text value={labels.daysInARow} size="sm" color="secondary" />
                </Col>
                <Col gap={1} padding={{ bottom: 1 }}>
                  <Text value={String(leader.best) + labels.daysSuffix} size="lg" weight="medium" tabularNums />
                  <Caption value={labels.bestStreak} />
                </Col>
              </Row>
              <Row gap={2} wrap="wrap">
                <Row gap={1}>
                  <Each of={days} item="day">
                    <Box key={day.index} size={20} radius="full" align="center" justify="center" background={leader.week[day.index] === 1 ? completeSurface : 'surface-secondary'}>
                      <Svg size={12} title={day.label + ': ' + (leader.week[day.index] === 1 ? labels.completed : labels.missed)} paths={marks[appearance][leader.week[day.index] === 1 ? 'done' : 'missed']} />
                    </Box>
                  </Each>
                </Row>
                <Caption value={format(leader.completed / size(days), 'percent', { digits: 0 }) + ' · ' + String(size(days) - leader.completed) + labels.missedSuffix} size="sm" />
              </Row>
            </Col>
            <Divider />
            <Col gap={3}>
              <Caption value={labels.streakHistoryScope} size="sm" />
              <Each of={entries.filter(habit => habit.id !== leader.id)} item="habit">
                <Col key={habit.id} gap={1}>
                  <Row gap={2} align="baseline">
                    <Col flex={1} minWidth={0}><Text value={habit.title} size="sm" weight="medium" /></Col>
                    <Text value={String(habit.current) + 'd'} size="sm" weight="semibold" tabularNums />
                  </Row>
                  <Row gap={2} wrap="wrap">
                    <Row gap={1}>
                      <Each of={days} item="day">
                        <Box key={day.index} size={18} radius="sm" align="center" justify="center" background={habit.week[day.index] === 1 ? completeSurface : 'surface-secondary'}>
                          <Svg size={12} title={day.label + ': ' + (habit.week[day.index] === 1 ? labels.completed : labels.missed)} paths={marks[appearance][habit.week[day.index] === 1 ? 'done' : 'missed']} />
                        </Box>
                      </Each>
                    </Row>
                    <Caption value={format(habit.completed / size(days), 'percent', { digits: 0 }) + ' · ' + String(size(days) - habit.completed) + labels.missedSuffix} size="sm" />
                  </Row>
                </Col>
              </Each>
            </Col>
            <Divider />
            <KeyValue gap={2} rows={[
              { label: labels.lastWeekCompletion, value: String(weeklyCount) + '/' + String(weeklyTotal) + ' · ' + format(weeklyCount / weeklyTotal, 'percent', { digits: 0 }) },
              { label: labels.missedHabitDaysLabel, value: String(weeklyTotal - weeklyCount) }
            ]} />
          </Card>
        </Col>
        <Text value={labels.localNote} size="sm" color="secondary" />
      </Box>
    </Basic>
  </Scope>
</Scope>