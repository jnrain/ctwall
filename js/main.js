requirejs(['jquery', 'qrcode', 'jquery.transit', 'jquery.fullscreen'], function($, QRCode) {
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
    QRCODE_BACKGROUND: "#efd984",
    API_DOMAIN: "spider.api.jnrain.com",
    SHORT_URL_DOMAIN: "spurl.jnrain.com",
    SHORT_URL_INFIXED: false
  };

  var CTWall = {
    state: {
      articles: {},
      qrcode: null,
      siteList: [],
      currentSiteIdx: null,
      currentArticleIdx: null
    },
    durationFromArticle: function(article) {
      var length = article.content.length;
      var dur = length / CTWallConfig.ARTICLE_STANDARD_LENGTH * CTWallConfig.ARTICLE_STANDARD_DURATION;

      if (dur < CTWallConfig.ARTICLE_MIN_DURATION)
        return CTWallConfig.ARTICLE_MIN_DURATION;
      if (dur > CTWallConfig.ARTICLE_MAX_DURATION)
        return CTWallConfig.ARTICLE_MAX_DURATION;
      return dur;
    },
    shortURLFromTag: function(tag) {
      var prefix = 'http://' + CTWallConfig.SHORT_URL_DOMAIN + '/',
          pathInfix = CTWallConfig.SHORT_URL_INFIXED ? 'g/' : '';

      return prefix + pathInfix + tag;
    },
    urlFromArticle: function(article) {
      // 没有短 URL, 就返回长的, 否则拼出来一个短的
      return (
          article.short_url
          ? CTWall.shortURLFromTag(article.short_url)
          : article.url
          );
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
      CTWall.state.qrcode.makeCode(CTWall.urlFromArticle(article));

      // 过一定时间显示下一篇文章, 显示时间长短由 durationFromArticle 函数确定
      var duration = CTWall.durationFromArticle(article);
      console.log('[ctwall] Next article in ' + duration.toString() + 'ms');
      setTimeout(CTWall.nextArticle, duration);
    },
    makeSiteElement: function(source) {
      return $('<li />')
        .addClass('article-nav__sites__site')
        .text(CTWallConfig.SOURCE_MAP[source]);
    },
    populateSites: function(siteList) {
      var sitesListElem = $('.article-nav__sites'),
          numSites = siteList.length;

      sitesListElem.empty();

      // 从第 2 个站开始按顺序加入站点列表, 这样站点列表第一项总是下一个要展示
      // 的站点. 这里使用了取模运算让最后一次循环绕回第一个元素
      for (var i = 0; i < numSites; i++) {
        var source = siteList[(i + 1) % numSites];

        // console.log("[ctwall] populating site '" + source + "'");
        sitesListElem.append(CTWall.makeSiteElement(source));
      }

      // 检查容器的高度足够显示多少个站, 至少要有这么多个站点元素才能制造出
      // 一种无限滚动的错觉
      // 现在站点元素的容器 (列表元素) 外边还有一层容器, 我们需要的是容器的
      // 内侧高度
      var containerHeight = sitesListElem.parent().innerHeight(),
          averageSiteElemHeight = sitesListElem.outerHeight() / numSites,
          numSitesDisplayed = Math.ceil(containerHeight / averageSiteElemHeight);

      // 继续往列表中加入 numSitesDisplayed - 1 个元素
      // 因为上一个站是第一个, 所以这次还是从第二个站开始
      for (var i = 0; i < numSitesDisplayed; i++) {
        var source = siteList[(i + 1) % numSites];
        // console.log("[ctwall] populating placeholder '" + source + "'");
        sitesListElem.append(CTWall.makeSiteElement(source));
      }
    },
    makeItemElement: function(article) {
      return $('<li />')
        .addClass('current-site__news-items__item')
        .text(article.title);
    },
    populateArticleList: function(articles, source) {
      var articleListElem = $('.current-site__news-items'),
          sourceItems = articles[source];

      console.log("[ctwall] populating article list for source '" + source + "'");

      articleListElem.empty();
      for (var i = 0; i < sourceItems.length; i++) {
        var article = sourceItems[i];

        // console.log("[ctwall] populating article ", article);
        articleListElem.append(CTWall.makeItemElement(article));
      }

      // 动画效果
      CTWall.resetScroll('.current-site__news-items');
    },
    scrollUpOne: function(selector, callback) {
      var targetElem = $(selector),
          targetChildElem = $(targetElem.children()[0]),
          deltaHeight = targetChildElem.outerHeight();

      targetElem.transition({top: '-=' + deltaHeight.toString() + 'px'}, callback);
    },
    resetScroll: function(selector) {
      $(selector)
        .css('left', '-100%')
        .css('top', '0')
        .transition({left: 0}, 750);
    },
    changeSiteName: function(name) {
      var elem = $('.current-site__site-name');

      elem.transition({top: '-100%'}, function() {
        elem
          .text(name)
          .css('top', '100%')
          .transition({top: '0'});
      });
    },
    nextArticle: function() {
      var newArticleIdx = CTWall.state.currentArticleIdx + 1,
          siteArticles = CTWall.state.articles[CTWall.state.siteList[CTWall.state.currentSiteIdx]];

      if (newArticleIdx == siteArticles.length) {
        // 当前站点已经全部展示完毕, 切换到下一个站的第一篇文章
        CTWall.nextSite();
        siteArticles = CTWall.state.articles[CTWall.state.siteList[CTWall.state.currentSiteIdx]];
        newArticleIdx = 0;
      } else {
        // 上滚一篇文章
        CTWall.scrollUpOne('.current-site__news-items');
      }

      // 取出并切换到下一篇文章
      var article = siteArticles[newArticleIdx];
      console.log(
          '[ctwall] Switching to site '
          + CTWall.state.currentSiteIdx.toString()
          + ' article '
          + newArticleIdx
          + ':',
          article
          );
      CTWall.switchArticle(article);

      CTWall.state.currentArticleIdx = newArticleIdx;
    },
    nextSite: function() {
      var newSiteIdx = CTWall.state.currentSiteIdx + 1;
      if (newSiteIdx == CTWall.state.siteList.length) {
        // 已经没有下一个站了, 滚回第一个
        newSiteIdx = 0;

        // 让站点列表向上滚动一格
        CTWall.scrollUpOne('.article-nav__sites', function() {
          // 重置站点列表元素的位置
          $('.article-nav__sites').css('top', '0');
        });
      } else {
        // 让站点列表向上滚动一格
        CTWall.scrollUpOne('.article-nav__sites');
      }

      // 更新当前站点变量
      CTWall.state.currentSiteIdx = newSiteIdx;
      var newSource = CTWall.state.siteList[newSiteIdx];

      // 更新当前站点名称显示
      CTWall.changeSiteName(CTWallConfig.SOURCE_MAP[newSource]);

      // 更新站点内新闻列表
      CTWall.populateArticleList(CTWall.state.articles, newSource);
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
    setMetadata: function(data) {
      CTWallConfig.API_DOMAIN = data.api_domain;
      CTWallConfig.SHORT_URL_DOMAIN = data.short_url_domain;
      CTWallConfig.SHORT_URL_INFIXED = data.short_url_infixed;
    },
    initMeta: function() {
      // 从元数据 API 初始化爬虫后端地址和短链服务特征, 覆盖脚本里固化的配置;
      // 如果失败就不作任何改动.
      $.getJSON('//meta.api.jnrain.com/campuspiders.json')
        .done(function(data) {
          console.log('[ctwall] Got metadata:', data);
          CTWall.setMetadata(data);
        }).fail(function() {
          console.log('[ctwall] Failed to fetch metadata, using fallback value');
        }).always(function() {
          console.log('[ctwall] API domain:', CTWallConfig.API_DOMAIN);
          console.log('[ctwall] Short URL domain:', CTWallConfig.SHORT_URL_DOMAIN);
          console.log('[ctwall] Short URL address is infixed:', CTWallConfig.SHORT_URL_INFIXED);

          CTWall.initFeed();
        });
    },
    initFeed: function() {
      $.getJSON('//' + CTWallConfig.API_DOMAIN + '/v1/feed/month/')
      .done(function(data) {
        console.log('[ctwall] Got feed:', data);

        // 初始化 QRCode
        CTWall.initQRCode();

        // 对文章分类
        var articleList = data.l;

        articleList.forEach(function(article) {
          var sourceMaybe = CTWall.state.articles[article.source];

          if (typeof sourceMaybe === 'undefined') {
            CTWall.state.articles[article.source] = [];
          }

          CTWall.state.articles[article.source].push(article);
        });

        // 敲掉新闻网
        // TODO: 更恰当的处理, 比如只在某时间段播放新闻
        if (typeof CTWall.state.articles['xinwen'] !== 'undefined') {
          delete CTWall.state.articles['xinwen'];
        }

        // 初始化站点列表
        CTWall.state.siteList = [];
        for (var siteName in CTWall.state.articles) {
          CTWall.state.siteList.push(siteName);
        }
        CTWall.populateSites(CTWall.state.siteList);

        // 初始化第一个站点的文章列表
        CTWall.populateArticleList(CTWall.state.articles, CTWall.state.siteList[0]);

        // 开始文章显示
        // 让当前文章处于第 0 站的第 -1 篇文章, 于是下一篇就是第 0 篇了
        CTWall.state.currentSiteIdx = 0;
        CTWall.state.currentArticleIdx = -1;
        CTWall.nextArticle();
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
      $('.datetime__date__month').text(WallClock.zeropad(now.getMonth() + 1));
      $('.datetime__date__day').text(WallClock.zeropad(now.getDate()));
      $('.datetime__weekday').text('日一二三四五六'[now.getDay()]);
    }
  };

  $(function() {
    console.log('[ctwall] CTWall =', CTWall);

    // 时钟
    setInterval(WallClock.pulse, 1000);

    // 全屏逻辑
    // 检测全屏状态改变的事件, 并据此隐藏或显示鼠标. 点击页面任何位置开关全屏模式.
    //
    // 注意, 由于浏览器从安全角度出发, 此处不能由脚本自动触发进入全屏模式,
    // 而必须由用户操作 (如点击) 触发, 否则会报如下错误信息 (以火狐为例):
    //
    //     全屏请求被拒绝，因为 Element.mozRequestFullScreen() 不是在一个短期运行的由用户引发的事件处理代码段中运行的。
    //
    // 但是, F11 进入的 "全屏" 模式不会触发全屏状态改变事件, 因此还必须提供一个交互机制,
    // 以实现从脚本调用全屏 API 实现鼠标状态改变的功能.
    //
    // 事件处理函数
    $(document).bind('fullscreenchange', function() {
      var newStatus = $(document).fullScreen();

      console.log('[ctwall] Fullscreen mode: now ' + (newStatus ? 'on' : 'off'));

      // 隐藏或显示鼠标
      $('.screen').css('cursor', newStatus ? 'none' : '');
    });

    // 鼠标点击函数
    $('.screen').click(function() {
      $(document).toggleFullScreen();
    });

    // 显示区域大小改变, 则等待一段时间后重新填充站点列表
    // 等待一段时间是为了防止频繁操作页面带来的性能问题
    (function() {
      var resizeTimer = null;

      $(window).resize(function() {
        if (resizeTimer !== null) {
          clearTimeout(resizeTimer);
        }

        // 最后一个大小改变事件发生 1 秒之后触发调整
        resizeTimer = setTimeout(function() {
          console.log('[ctwall] Resize complete, repopulate site list');
          resizeTimer = null;

          CTWall.populateSites(CTWall.state.siteList);
        }, 1000);
      });
    })();

    // 初始化新闻条目信息
    CTWall.initMeta();
  });
});


// vim:set ai et ts=2 sw=2 sts=2 fenc=utf-8:
