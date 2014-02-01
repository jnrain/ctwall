requirejs(['jquery', 'qrcode'], function($, QRCode) {
  'use strict';

  var CTWallConfig = {
    ARTICLE_MIN_DURATION: 10000,
    ARTICLE_MAX_DURATION: 40000,
    ARTICLE_STANDARD_LENGTH: 600,
    ARTICLE_STANDARD_DURATION: 30000,
    SOURCE_MAP: {
      jw: "教务处",
      xinwen: "江大新闻网",
      dm: "数字媒体学院"
    },
    QRCODE_DIMENSION: 150,
    QRCODE_BACKGROUND: "#efd984"
  };

  var CTWall = {
    state: {
      qrcode: null
    },
    durationFromArticle: function(article) {
      var length = article.content.length;
      var dur = length / ARTICLE_STANDARD_LENGTH * ARTICLE_STANDARD_DURATION;

      if (dur < ARTICLE_MIN_DURATION)
        return ARTICLE_MIN_DURATION;
      if (dur > ARTICLE_MAX_DURATION)
        return ARTICLE_MAX_DURATION;
      return dur;
    },
    switchArticle: function(article) {
      $('.current-article__title').text(article.title);

      // 把内容的纯文本转成 HTML 段落
      // TODO: 让后端标记哪些内容是 raw HTML, 尝试支持不损失文本格式抓取
      // 多数浏览器不支持 JS 1.7, 暂时不能这么写
      // var contentHTML = ['<p>' + frag + '</p>' for each (frag in article.content.split('\n'))];
      var contentLines = article.content.split('\n');
      var contentHTML = [];
      for (var i = 0; i < contentLines.length; i++) {
        contentHTML.push('<p>' + contentLines[i] + '</p>');
      }

      $('.current-article__content').html(contentHTML.join('\n'));
      $('.current-site__site-name').text(CTWallConfig.SOURCE_MAP[article.source]);

      // QRCode
      CTWall.state.qrcode.makeCode(article.url);
    },
    initQRCode: function() {
      // 注意必须传入原生 DOM 元素
      CTWall.state.qrcode = new QRCode(
          $('.current-article__qrcode')[0],
          {
            width: CTWallConfig.QRCODE_DIMENSION,
            height: CTWallConfig.QRCODE_DIMENSION,
            colorLight: CTWallConfig.QRCODE_BACKGROUND
          });
    },
    initFeed: function() {
      $.getJSON('ctwall-feed.json')
      .done(function(data) {
        console.log('[ctwall] Got feed:', data);

        // 初始化 QRCode
        CTWall.initQRCode();

        // 开始文章显示
        CTWall.switchArticle(data.l[0]);
      }).fail(function() {
        console.log('feed request failed');
      });
    }
  };

  var WallClock = {
    zeropad: function(x) {
      if (x >= 10)
        return x.toString();
      return '0' + x.toString();
    },
    pulse: function() {
      var now = new Date();

      $('.datetime__time__hour').text(WallClock.zeropad(now.getHours()));
      $('.datetime__time__minute').text(WallClock.zeropad(now.getMinutes()));
      $('.datetime__date__month').text(now.getMonth() + 1);
      $('.datetime__date__day').text(now.getDate());
      $('.datetime__weekday').text('日一二三四五六'[now.getDay()]);
    }
  };

  $(function() {
    // 时钟
    setInterval(WallClock.pulse, 1000);

    // 初始化新闻条目信息
    CTWall.initFeed();
  });
});


// vim:set ai et ts=2 sw=2 sts=2 fenc=utf-8:
