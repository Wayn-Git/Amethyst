<Scope values={{ sTrack: tracks[small.index], mTrack: tracks[immersive.index], rTrack: tracks[rich.index], eTrack: tracks[editorial.index], mPos: clamp(Number(immersive.position) || 0, 0, tracks[immersive.index].duration), rPos: clamp(Number(rich.position) || 0, 0, tracks[rich.index].duration), ePos: clamp(Number(editorial.position) || 0, 0, tracks[editorial.index].duration) }}>
  <Basic align="center" gap={6}>
    <Box width="100%" maxWidth={340} gap={6}>
      <Col gap={1}>
        <Title value={labels.title} size="md" />
        <Text value={labels.demo} size="xs" color="secondary" />
      </Col>

      <Col gap={2}>
        <Row gap={2} justify="between" wrap="wrap">
          <Text value={labels.minimal} size="xs" weight="semibold" />
          <Text value={labels.smallSize} size="xs" color="secondary" />
        </Row>
        <Card width={160} height={160} padding={0} gap={0} background="transparent" shadow={false}>
          <Box width="100%" height={160} radius="2xl" clip background="surface-elevated" padding={4} justify="between">
            <Row justify="between" gap={2}>
              <Image src={availableImages[sTrack.art].url} alt={sTrack.artAlt} size={48} radius="sm" />
              <Button uniform size="2xl" pill variant="soft" color="secondary" iconStart={small.playing ? 'pause' : 'play'} ariaLabel={small.playing ? labels.pause : labels.play} $onClickAction='{ patchState: set("small.playing", !small.playing) }' />
            </Row>
            <Col gap={1}>
              <Text value={sTrack.title} size="md" weight="semibold" color="emphasis" />
              <Text value={sTrack.artist} size="xs" color="secondary" />
            </Col>
          </Box>
        </Card>
      </Col>

      <Col gap={2}>
        <Row gap={2} justify="between" wrap="wrap">
          <Text value={labels.immersive} size="xs" weight="semibold" />
          <Text value={labels.mediumSize} size="xs" color="secondary" />
        </Row>
        <Card width="100%" height={160} padding={0} gap={0} background="transparent" shadow={false} theme="dark">
          <Box width="100%" height={160} radius="2xl" clip padding={5} justify="between" background={"linear-gradient(90deg, rgba(20, 15, 20, 0.87), rgba(20, 15, 20, 0.64)), url('" + availableImages[mTrack.art].url + "') center / cover"}>
            <Show when={immersive.playing}>
              <RunInterval key="immersive-clock" interval={1000} $onTickAction='{ patchState: [set("immersive.position", min(mTrack.duration, mPos + 1)), set("immersive.playing", mPos + 1 < mTrack.duration)] }' />
            </Show>
            <Row gap={2} align="center">
              <Col flex={1} minWidth={0} gap={1}>
                <Title value={mTrack.title} size="sm" />
                <Text value={mTrack.artist} size="xs" color="primary" />
              </Col>
              <Box direction="row" align="center" gap={0} padding={1} radius="full" background="rgba(0, 0, 0, 0.30)">
                <Button uniform pill size="xl" variant="ghost" color="primary" iconStart="skip-back" ariaLabel={labels.previous} $onClickAction='{ patchState: [set("immersive.index", (immersive.index + size(tracks) - 1) % size(tracks)), set("immersive.position", 0)] }' />
                <Button uniform pill size="xl" variant="soft" color="primary" iconStart={immersive.playing ? 'pause' : 'play'} ariaLabel={immersive.playing ? labels.pause : labels.play} $onClickAction='{ patchState: [set("immersive.playing", !immersive.playing), set("immersive.position", mPos >= mTrack.duration ? 0 : mPos)] }' />
                <Button uniform pill size="xl" variant="ghost" color="primary" iconStart="skip-forward" ariaLabel={labels.next} $onClickAction='{ patchState: [set("immersive.index", (immersive.index + 1) % size(tracks)), set("immersive.position", 0)] }' />
              </Box>
            </Row>
            <Popover>
              <Popover.Trigger>
                <Col gap={1} width="100%">
                  <Progress value={mPos} max={mTrack.duration} showValue={false} size="sm" />
                  <Row justify="between" gap={2}>
                    <Text value={String(floor(mPos / 60)) + ':' + String(floor(mPos % 60)).padStart(2, '0')} size="xs" tabularNums />
                    <Text value={labels.seek} size="xs" />
                    <Text value={'−' + String(floor((mTrack.duration - mPos) / 60)) + ':' + String(floor((mTrack.duration - mPos) % 60)).padStart(2, '0')} size="xs" tabularNums />
                  </Row>
                </Col>
              </Popover.Trigger>
              <Popover.Content width={248}>
                <Col gap={2}>
                  <Label value={labels.position} fieldName="immersive.position" />
                  <Input name="immersive.position" bind="immersive.position" inputType="number" size="2xl" invalid={Number(immersive.position) !== mPos || !has(String(immersive.position))} />
                  <Text value={labels.rangePrefix + String(mTrack.duration) + labels.rangeSuffix} size="xs" />
                </Col>
              </Popover.Content>
            </Popover>
          </Box>
        </Card>
      </Col>

      <Col gap={2}>
        <Row gap={2} justify="between" wrap="wrap">
          <Col gap={1}>
            <Text value={labels.rich} size="xs" weight="semibold" />
            <Text value={labels.largeSize} size="xs" color="secondary" />
          </Col>
          <Button label={rich.hasTrack ? labels.emptyPreview : labels.restore} variant="ghost" size="2xl" $onClickAction='{ patchState: [set("rich.hasTrack", !rich.hasTrack), set("rich.playing", false)] }' />
        </Row>
        <Card width="100%" height={340} padding={0} gap={0} background="transparent" shadow={false}>
          <Box width="100%" height={340} radius="2xl" clip background="surface-elevated" padding={5} gap={3} justify="between">
            <Show when={rich.hasTrack}>
              <Show when={rich.playing}>
                <RunInterval key="rich-clock" interval={1000} $onTickAction='{ patchState: [set("rich.position", min(rTrack.duration, rPos + 1)), set("rich.playing", rPos + 1 < rTrack.duration)] }' />
              </Show>
              <Row gap={3}>
                <Image src={availableImages[rTrack.art].url} alt={rTrack.artAlt} size={64} radius="md" />
                <Col flex={1} minWidth={0} gap={1}>
                  <Title value={rTrack.title} size="sm" />
                  <Text value={rTrack.artist} size="xs" color="secondary" />
                  <Row gap={1}>
                    <Icon name="desktop" size="xs" color="secondary" />
                    <Text value={labels.device} size="xs" color="secondary" />
                  </Row>
                </Col>
              </Row>
              <Popover>
                <Popover.Trigger>
                  <Col gap={1} width="100%">
                    <Progress value={rPos} max={rTrack.duration} showValue={false} size="sm" />
                    <Row justify="between" gap={2}>
                      <Text value={String(floor(rPos / 60)) + ':' + String(floor(rPos % 60)).padStart(2, '0')} size="xs" color="secondary" tabularNums />
                      <Text value={labels.seek} size="xs" color="secondary" />
                      <Text value={'−' + String(floor((rTrack.duration - rPos) / 60)) + ':' + String(floor((rTrack.duration - rPos) % 60)).padStart(2, '0')} size="xs" color="secondary" tabularNums />
                    </Row>
                  </Col>
                </Popover.Trigger>
                <Popover.Content width={248}>
                  <Col gap={2}>
                    <Label value={labels.position} fieldName="rich.position" />
                    <Input name="rich.position" bind="rich.position" inputType="number" size="2xl" invalid={Number(rich.position) !== rPos || !has(String(rich.position))} />
                    <Text value={labels.rangePrefix + String(rTrack.duration) + labels.rangeSuffix} size="xs" />
                  </Col>
                </Popover.Content>
              </Popover>
              <Row gap={6} justify="center">
                <Button uniform size="2xl" variant="ghost" iconStart="skip-back" ariaLabel={labels.previous} $onClickAction='{ patchState: [set("rich.index", (rich.index + size(tracks) - 1) % size(tracks)), set("rich.position", 0)] }' />
                <Button uniform pill size="3xl" color="primary" iconStart={rich.playing ? 'pause' : 'play'} ariaLabel={rich.playing ? labels.pause : labels.play} $onClickAction='{ patchState: [set("rich.playing", !rich.playing), set("rich.position", rPos >= rTrack.duration ? 0 : rPos)] }' />
                <Button uniform size="2xl" variant="ghost" iconStart="skip-forward" ariaLabel={labels.next} $onClickAction='{ patchState: [set("rich.index", (rich.index + 1) % size(tracks)), set("rich.position", 0)] }' />
              </Row>
              <Divider color="subtle" />
              <Col gap={2}>
                <Text value={labels.upNext} size="xs" weight="semibold" color="secondary" />
                <Each of={range(1, 3)} item="offset">
                  <Scope values={{ queued: tracks[(rich.index + offset) % size(tracks)] }}>
                    <Row key={queued.id} gap={2}>
                      <Image src={availableImages[queued.art].url} alt={queued.artAlt} size={28} radius="xs" />
                      <Col flex={1} minWidth={0} gap={0}>
                        <Text value={queued.title} size="xs" weight="medium" />
                        <Text value={queued.artist} size="xs" color="secondary" />
                      </Col>
                      <Text value={queued.durationLabel} size="xs" color="secondary" tabularNums />
                    </Row>
                  </Scope>
                </Each>
              </Col>
              <Show.Else>
                <Col height="100%" align="center" justify="center" gap={4}>
                  <Icon name="music" size="3xl" color="tertiary" />
                  <Col gap={1} align="center">
                    <Title value={labels.emptyTitle} size="sm" />
                    <Text value={labels.emptyHint} size="xs" color="secondary" textAlign="center" />
                  </Col>
                  <Button label={labels.restore} variant="outline" size="2xl" $onClickAction='{ patchState: [set("rich.hasTrack", true), set("rich.position", 0), set("rich.playing", false)] }' />
                </Col>
              </Show.Else>
            </Show>
          </Box>
        </Card>
      </Col>

      <Col gap={2}>
        <Row gap={2} justify="between" wrap="wrap">
          <Col gap={1}>
            <Text value={labels.editorial} size="xs" weight="semibold" />
            <Text value={labels.largeSize} size="xs" color="secondary" />
          </Col>
          <Button label={editorial.hasTrack ? labels.emptyPreview : labels.restore} variant="ghost" size="2xl" $onClickAction='{ patchState: [set("editorial.hasTrack", !editorial.hasTrack), set("editorial.playing", false)] }' />
        </Row>
        <Card width="100%" height={340} padding={0} gap={0} background="transparent" shadow={false}>
          <Box width="100%" height={340} radius="2xl" clip background={editorialSurface} gap={0}>
            <Show when={editorial.hasTrack}>
              <Show when={editorial.playing}>
                <RunInterval key="editorial-clock" interval={1000} $onTickAction='{ patchState: [set("editorial.position", min(eTrack.duration, ePos + 1)), set("editorial.playing", ePos + 1 < eTrack.duration)] }' />
              </Show>
              <Row gap={0} align="stretch" height={172}>
                <Image src={availableImages[eTrack.art].url} alt={eTrack.artAlt} width="42%" height={172} radius="none" fit="cover" />
                <Col flex={1} minWidth={0} padding={5} justify="between" gap={2}>
                  <Text value={labels.nowPlaying} size="xs" color="secondary" />
                  <Col gap={2}>
                    <Title value={eTrack.title} size="lg" weight="medium" />
                    <Text value={eTrack.artist} size="xs" color="secondary" />
                  </Col>
                </Col>
              </Row>
              <Col padding={5} gap={2} height={168} justify="between">
                <Popover>
                  <Popover.Trigger>
                    <Col gap={1} width="100%">
                      <Progress value={ePos} max={eTrack.duration} showValue={false} size="sm" />
                      <Row justify="between" gap={2}>
                        <Text value={String(floor(ePos / 60)) + ':' + String(floor(ePos % 60)).padStart(2, '0')} size="xs" color="secondary" tabularNums />
                        <Text value={labels.seek} size="xs" color="secondary" />
                        <Text value={'−' + String(floor((eTrack.duration - ePos) / 60)) + ':' + String(floor((eTrack.duration - ePos) % 60)).padStart(2, '0')} size="xs" color="secondary" tabularNums />
                      </Row>
                    </Col>
                  </Popover.Trigger>
                  <Popover.Content width={248}>
                    <Col gap={2}>
                      <Label value={labels.position} fieldName="editorial.position" />
                      <Input name="editorial.position" bind="editorial.position" inputType="number" size="2xl" invalid={Number(editorial.position) !== ePos || !has(String(editorial.position))} />
                      <Text value={labels.rangePrefix + String(eTrack.duration) + labels.rangeSuffix} size="xs" />
                    </Col>
                  </Popover.Content>
                </Popover>
                <Row justify="between" gap={2}>
                  <Row gap={2}>
                    <Button uniform size="2xl" variant="ghost" iconStart="skip-back" ariaLabel={labels.previous} $onClickAction='{ patchState: [set("editorial.index", (editorial.index + size(tracks) - 1) % size(tracks)), set("editorial.position", 0)] }' />
                    <Button uniform pill size="2xl" variant="soft" color="primary" iconStart={editorial.playing ? 'pause' : 'play'} ariaLabel={editorial.playing ? labels.pause : labels.play} $onClickAction='{ patchState: [set("editorial.playing", !editorial.playing), set("editorial.position", ePos >= eTrack.duration ? 0 : ePos)] }' />
                    <Button uniform size="2xl" variant="ghost" iconStart="skip-forward" ariaLabel={labels.next} $onClickAction='{ patchState: [set("editorial.index", (editorial.index + 1) % size(tracks)), set("editorial.position", 0)] }' />
                  </Row>
                  <Text value={eTrack.durationLabel} size="xs" color="secondary" tabularNums />
                </Row>
                <Divider color="subtle" />
                <Row justify="between" align="baseline" gap={2} wrap="wrap">
                  <Text value={eTrack.album} size="xs" weight="medium" />
                  <Text value={eTrack.detail} size="xs" color="secondary" />
                </Row>
              </Col>
              <Show.Else>
                <Col height={340} padding={5} align="center" justify="center" gap={4}>
                  <Icon name="music" size="3xl" color="tertiary" />
                  <Col gap={1} align="center">
                    <Title value={labels.emptyTitle} size="sm" />
                    <Text value={labels.emptyHint} size="xs" color="secondary" textAlign="center" />
                  </Col>
                  <Button label={labels.restore} variant="outline" size="2xl" $onClickAction='{ patchState: [set("editorial.hasTrack", true), set("editorial.position", 0), set("editorial.playing", false)] }' />
                </Col>
              </Show.Else>
            </Show>
          </Box>
        </Card>
      </Col>
      <Text value={labels.artNote} size="xs" color="secondary" />
    </Box>
  </Basic>
</Scope>