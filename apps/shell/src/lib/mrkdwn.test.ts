import { describe, expect, it } from 'vitest';
import { mentionsUser, mrkdwnToPlain, plainToMrkdwn, renderMrkdwn, type MrkdwnContext } from './mrkdwn';
import { emojiChar } from './emoji';

const ctx: MrkdwnContext = {
  userName: (id) => ({ U01DANA: 'dana', U01ME: 'mei' })[id],
  channelName: (id) => ({ C01NEWS: 'newsroom' })[id],
  emoji: (name) => (name === 'partyparrot' ? { url: 'https://emoji.slack-edge.com/T1/partyparrot/abc.gif' } : { char: emojiChar(name) }),
  selfId: 'U01ME',
};

describe('renderMrkdwn', () => {
  it('跳脫 HTML，不讓訊息注入標籤', () => {
    // Slack 會把 < > & 轉成實體；即使拿到未轉義的 script 字樣也只會變成文字
    expect(renderMrkdwn('&lt;script&gt;alert(1)&lt;/script&gt; &amp; "hi"')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;hi&quot;',
    );
  });

  it('粗體、斜體、刪除線、行內程式碼', () => {
    expect(renderMrkdwn('*bold* _it_ ~gone~ `a*b*c`')).toBe('<b>bold</b> <i>it</i> <s>gone</s> <code>a*b*c</code>');
  });

  it('單字內的底線與星號不當成標記', () => {
    expect(renderMrkdwn('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
  });

  it('提及使用者、自己、頻道與廣播', () => {
    const html = renderMrkdwn('<@U01DANA> <@U01ME> <#C01NEWS> <#C02X|general> <!here>', ctx);
    expect(html).toContain('<span class="mention" data-user="U01DANA">@dana</span>');
    expect(html).toContain('<span class="mention self" data-user="U01ME">@mei</span>');
    expect(html).toContain('#newsroom');
    expect(html).toContain('#general');
    expect(html).toContain('<span class="mention broadcast">@here</span>');
  });

  it('連結：有標籤、無標籤、不安全的協定', () => {
    expect(renderMrkdwn('<https://example.com/ipad|iPad>')).toBe(
      '<a href="https://example.com/ipad" target="_blank" rel="noreferrer">iPad</a>',
    );
    expect(renderMrkdwn('<https://a.com/?x=1&amp;y=2>')).toBe(
      '<a href="https://a.com/?x=1&amp;y=2" target="_blank" rel="noreferrer">https://a.com/?x=1&amp;y=2</a>',
    );
    expect(renderMrkdwn('<javascript:alert(1)|click>')).toBe('click');
  });

  it('樣式可以包住提及', () => {
    expect(renderMrkdwn('*hey <@U01DANA>*', ctx)).toBe('<b>hey <span class="mention" data-user="U01DANA">@dana</span></b>');
  });

  it('emoji：標準、膚色、自訂、未知', () => {
    expect(renderMrkdwn(':+1: :wave::skin-tone-3: :partyparrot: :nope:', ctx)).toBe(
      '<span class="emoji" title=":+1:">👍</span> <span class="emoji" title=":wave:">👋🏼</span> ' +
        '<img class="emoji" alt=":partyparrot:" src="https://emoji.slack-edge.com/T1/partyparrot/abc.gif"> :nope:',
    );
  });

  it('程式碼區塊內不做任何格式', () => {
    expect(renderMrkdwn('see\n```\n*not bold* <@U1>\n```\ndone')).toBe('see<pre>*not bold* &lt;@U1&gt;</pre>done');
  });

  it('引用與換行', () => {
    expect(renderMrkdwn('&gt; Find My for AirPods\n&gt; requires AirPods Pro\nyep')).toBe(
      '<blockquote>Find My for AirPods<br>requires AirPods Pro</blockquote>yep',
    );
    expect(renderMrkdwn('a\nb')).toBe('a<br>b');
  });

  it('俚語加點狀底線，不分大小寫、不吃掉提及', () => {
    const html = renderMrkdwn('support doc Fine Print fwiw <@U01DANA>', { ...ctx, idioms: ['fine print', 'fwiw'] });
    expect(html).toBe(
      'support doc <span class="idiom" tabindex="0" data-idiom="fine print">Fine Print</span> ' +
        '<span class="idiom" tabindex="0" data-idiom="fwiw">fwiw</span> <span class="mention" data-user="U01DANA">@dana</span>',
    );
  });

  it('沒有結尾的 ``` 當普通文字', () => {
    expect(renderMrkdwn('a ```b')).toBe('a ```b');
  });
});

describe('mrkdwnToPlain / plainToMrkdwn', () => {
  it('翻譯輸入：提及換名字、連結取標籤、實體解碼', () => {
    expect(mrkdwnToPlain('<@U01DANA> see <https://x.com|this> &amp; <!here>', ctx)).toBe('@dana see this & @here');
  });
  it('送出時跳脫 Slack 保留字元', () => {
    expect(plainToMrkdwn('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
  it('判斷是否提及自己', () => {
    expect(mentionsUser('hi <@U01ME>', 'U01ME')).toBe(true);
    expect(mentionsUser('<!channel> heads up', 'U01ME')).toBe(true);
    expect(mentionsUser('hi <@U01DANA>', 'U01ME')).toBe(false);
  });
});
