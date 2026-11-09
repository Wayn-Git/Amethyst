import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractInstagramShortcode,
  parseInstagramEmbedHtml,
  extractInstagramTier1,
} from '../src/mobile/instagramExtractor.js'

test('Instagram Extractor: Shortcode Parsing', () => {
  assert.equal(extractInstagramShortcode('https://www.instagram.com/reel/DV79WToDXwb/'), 'DV79WToDXwb')
  assert.equal(extractInstagramShortcode('https://www.instagram.com/p/Dfg7exjmqI2/?utm_source=chatgpt.com'), 'Dfg7exjmqI2')
  assert.equal(extractInstagramShortcode('https://instagr.am/tv/12345/'), '12345')
  assert.equal(extractInstagramShortcode('https://instagram.com/reels/ABCDEF/'), 'ABCDEF')
  assert.equal(extractInstagramShortcode('https://google.com/search'), null)
})

test('Instagram Extractor: Parse Carousel Embed HTML', () => {
  const fakeCarouselContext = {
    gql_data: {
      shortcode_media: {
        shortcode: 'Dfg7exjmqI2',
        __typename: 'GraphSidecar',
        is_video: false,
        edge_media_to_caption: {
          edges: [{ node: { text: 'Carousel caption #design' } }],
        },
        owner: { username: 'testuser', full_name: 'Test User' },
        edge_sidecar_to_children: {
          edges: [
            { node: { id: 'slide1', __typename: 'GraphImage', display_url: 'https://cdn.example.com/1.jpg' } },
            { node: { id: 'slide2', __typename: 'GraphImage', display_url: 'https://cdn.example.com/2.jpg' } },
          ],
        },
      },
    },
  }

  const fakeHtml = `
    <html>
      <script>
        s.handle({"require": [[["PolarisEmbedContext"], "setContext", [], [{"contextJSON": ${JSON.stringify(JSON.stringify(fakeCarouselContext))}}]]]});
      </script>
    </html>
  `

  const result = parseInstagramEmbedHtml(fakeHtml, 'Dfg7exjmqI2')
  assert.equal(result.status, 'ready')
  assert.equal(result.mediaType, 'sidecar')
  assert.equal(result.isVideo, false)
  assert.equal(result.caption, 'Carousel caption #design')
  assert.equal(result.owner.username, 'testuser')
  assert.equal(result.sidecarChildren.length, 2)
  assert.equal(result.sidecarChildren[0].displayUrl, 'https://cdn.example.com/1.jpg')
})

test('Instagram Extractor: Parse Licensed Video Reel (Needs Tier 2)', () => {
  const fakeLicensedContext = {
    gql_data: {
      shortcode_media: {
        shortcode: 'DdXGIh1JE4m',
        __typename: 'GraphVideo',
        is_video: true,
        video_url: null, // Meta suppressed due to commercial music!
        clips_music_attribution_info: {
          song_name: 'Runaway',
          artist_name: 'Kanye West',
          uses_original_audio: false,
          should_mute_audio: false,
        },
        edge_media_to_caption: {
          edges: [{ node: { text: 'Video with licensed track' } }],
        },
        owner: { username: 'creator1' },
      },
    },
  }

  const fakeHtml = `
    <html>
      <script>
        s.handle({"require": [[["PolarisEmbedContext"], "setContext", [], [{"contextJSON": ${JSON.stringify(JSON.stringify(fakeLicensedContext))}}]]]});
      </script>
    </html>
  `

  const result = parseInstagramEmbedHtml(fakeHtml, 'DdXGIh1JE4m')
  assert.equal(result.status, 'needs_tier2')
  assert.equal(result.mediaType, 'video')
  assert.equal(result.isVideo, true)
  assert.equal(result.videoUrl, null)
  assert.equal(result.music.songName, 'Runaway')
  assert.equal(result.music.artistName, 'Kanye West')
  assert.equal(result.music.usesOriginalAudio, false)
})

test('Instagram Extractor: extractInstagramTier1 Mock HTTP', async () => {
  const mockHttp = async ({ url }) => {
    assert.match(url, /DV79WToDXwb\/embed\/captioned\//)
    const context = {
      gql_data: {
        shortcode_media: {
          shortcode: 'DV79WToDXwb',
          __typename: 'GraphVideo',
          is_video: true,
          video_url: 'https://cdn.instagram.com/v/test.mp4',
          clips_music_attribution_info: {
            song_name: 'Original audio',
            artist_name: 'creator',
            uses_original_audio: true,
          },
          edge_media_to_caption: {
            edges: [{ node: { text: 'Direct video test' } }],
          },
          owner: { username: 'creator' },
        },
      },
    }
    return {
      status: 200,
      data: `<html><script>s.handle({"require": [[["PolarisEmbedContext"], "setContext", [], [{"contextJSON": ${JSON.stringify(JSON.stringify(context))}}]]]});</script></html>`,
    }
  }

  const result = await extractInstagramTier1('https://www.instagram.com/reel/DV79WToDXwb/', { http: mockHttp })
  assert.equal(result.status, 'ready')
  assert.equal(result.videoUrl, 'https://cdn.instagram.com/v/test.mp4')
  assert.equal(result.music.songName, 'Original audio')
})
