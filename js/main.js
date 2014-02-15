requirejs(['jquery', 'qrcode', 'jquery.transit', 'jquery.fullscreen', 'jquery.knob'], function($, QRCode) {
  'use strict';

  var zeropad = (function(x) {
      if (x >= 10)
        return x.toString();
      return '0' + x.toString();
    });

  var CTWallConfig = {
    ARTICLE_MIN_DURATION: 7000,
    ARTICLE_MAX_DURATION: 35000,
    ARTICLE_STANDARD_LENGTH: 600,
    ARTICLE_STANDARD_DURATION: 30000,
    SOURCE_MAP: {
      dm: "数字媒体学院",
      jw: "教务处",
      xinwen: "江大新闻网",
      scc: "江大就业信息网",
      jdcy: "大学生创业网",
      gs: "研究生院",
      hq: "江大后勤信息网",
      nic: "信息建管中心",
      hqc: "江大后勤管理处",
      bwch: "江大保卫处"
    },
    QRCODE_DIMENSION: 165,
    QRCODE_BACKGROUND: "#efd984",
    PROGRESS_UPDATE_INTERVAL: 500,
    API_DOMAIN: "spider.api.jnrain.com",
    SHORT_URL_DOMAIN: "spurl.jnrain.com",
    SHORT_URL_INFIXED: false,
    RETRY_INITIAL_WAIT_DURATION: 4000,
    RETRY_EXPONENTIAL_BACKOFF_MULTIPLIER: 1.25
  };

  var CTWall = {
    state: {
      articles: {},
      qrcode: null,
      siteList: [],
      currentSiteIdx: null,
      currentArticleIdx: null,
      articleProgressElem: null,
      articleProgressTimer: null,
      lastRequestTime: null,
      lastRequestFailed: false,
      lastRequestRetryWaitDuration: 0
    },
    normalizeContent: function(s) {
      var tmp = s;

      // 去除标点数字等阅读速度极快的字符和空白字符
      tmp = tmp.replace(/[0-9\s　,.:;<>()\[\]{}/\\，、．。：；“”‘’（）【】〔〕《》]+/g, '');

      // 按照一次 7 个字符为人阅读速度极限, 把连续的字母数字等转换为虚拟的 "字"
      // 进而可以按虚拟的字数估算阅读时间
      tmp = tmp.replace(/[A-Za-z@+%-]{1,7}/g, ' ');
      // console.log(tmp);

      return tmp;
    },
    durationFromArticle: function(article) {
      var normalizedContent = CTWall.normalizeContent(article.content),
          length = normalizedContent.length,
          dur = Math.floor(length / CTWallConfig.ARTICLE_STANDARD_LENGTH * CTWallConfig.ARTICLE_STANDARD_DURATION);

      // console.log('[ctwall] durationFromArticle: raw length = ' + article.content.length.toString());
      // console.log('[ctwall] durationFromArticle: normalized length = ' + length.toString());
      // console.log('[ctwall] durationFromArticle: raw duration = ' + dur.toString() + 'ms');

      if (dur < CTWallConfig.ARTICLE_MIN_DURATION)
        return CTWallConfig.ARTICLE_MIN_DURATION;
      if (dur > CTWallConfig.ARTICLE_MAX_DURATION)
        return CTWallConfig.ARTICLE_MAX_DURATION;
      return dur;
    },
    timeStringFromArticle: function(article) {
      var date = new Date(article.ctime * 1000),
          dateStr = date.toLocaleDateString();

      if (date.getHours() == 0 && date.getMinutes() == 0 && date.getSeconds() == 0) {
        // 一般来说不会正好在午夜发新闻, 所以把这种情况理解为数据源只提供了
        // 精确到日的数据. 这样的话就不显示到分钟了
        return dateStr;
      }

      // 拼接小时分钟, 返回
      var timeStr = zeropad(date.getHours()) + ':' + zeropad(date.getMinutes());

      return dateStr + ' ' + timeStr;
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
    progressTimerFromDuration: function(duration) {
      var timeElapsed = 0,
          timerFn = (function() {
            timeElapsed += CTWallConfig.PROGRESS_UPDATE_INTERVAL;
            if (timeElapsed > duration) {
              CTWall.state.articleProgressTimer = null;
              return;
            }

            CTWall.state.articleProgressElem.val(timeElapsed / duration * 100).trigger('change');
            CTWall.state.articleProgressTimer = setTimeout(timerFn, CTWallConfig.PROGRESS_UPDATE_INTERVAL);
          });

      return timerFn;
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
      $('.current-article__time').text(CTWall.timeStringFromArticle(article));

      // QRCode
      CTWall.state.qrcode.makeCode(CTWall.urlFromArticle(article));

      // 过一定时间显示下一篇文章, 显示时间长短由 durationFromArticle 函数确定
      var duration = CTWall.durationFromArticle(article);
      console.log('[ctwall] Next article in ' + duration.toString() + 'ms');
      setTimeout(CTWall.nextArticle, duration);

      // 重置文章进度指示
      if (CTWall.state.articleProgressTimer !== null) {
        clearTimeout(CTWall.state.articleProgressTimer);
      }
      (CTWall.progressTimerFromDuration(duration))();
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
        // 如果不是第一篇, 就上滚一篇文章
        if (newArticleIdx !== 0) {
          CTWall.scrollUpOne('.current-site__news-items');
        }
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
        // 已经没有下一个站了, 准备进行下一次请求
        // 让站点列表向上滚动一格
        CTWall.scrollUpOne('.article-nav__sites', function() {
          // 重置站点列表元素的位置
          $('.article-nav__sites').css('top', '0');

          // 获取下一组文章
          CTWall.initFeed();
        });

        return;
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
    onFeedRequestSuccess: function(data) {
      CTWall.state.lastRequestTime = new Date();

      CTWall.state.lastRequestFailed = false;
      // 隐藏加载失败提示
      CTWall.setLoadErrorVisibility(false);

      // 初始化 QRCode
      CTWall.maybeInitQRCode();

      // 刷新最近更新时间
      CTWall.updateLastRequestTimeDisplay(CTWall.state.lastRequestTime);

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
    },
    updateLastRequestTimeDisplay: function(date) {
      $('.last-fetch-time').text(
          date.toLocaleDateString()
          + ' ' + zeropad(date.getHours())
          + ':' + zeropad(date.getMinutes())
          + ':' + zeropad(date.getSeconds())
          );
    },
    onFeedRequestFailure: function() {
      // 显示加载失败提示
      CTWall.setLoadErrorVisibility(true);

      // 计算下次重试时间
      var waitDuration = CTWall.calculateRetryWaitDuration(CTWall.state.lastRequestRetryWaitDuration);
      CTWall.state.lastRequestRetryWaitDuration = waitDuration;

      // 启动重试倒计时
      setTimeout(CTWall.makeRetryTimer(waitDuration), 1000);

      CTWall.state.lastRequestFailed = true;
    },
    calculateRetryWaitDuration: function(lastDuration) {
      if (CTWall.state.lastRequestFailed) {
        // 上次请求也失败了, 指数退避 (exponential backoff)
        return lastDuration * CTWallConfig.RETRY_EXPONENTIAL_BACKOFF_MULTIPLIER;
      }

      // 返回初始重试时间间隔
      return CTWallConfig.RETRY_INITIAL_WAIT_DURATION;
    },
    retryFeedRequest: function() {
      // 恶趣味, 旋转面无表情图标
      // 其实是给用户一些视觉反馈
      $('.load-error__title__icon').addClass('fa-spin');

      // 重新发送请求
      CTWall.initFeed();
    },
    makeRetryTimer: function(duration) {
      var remaining = duration;

      var timerFn = (function() {
        remaining -= 1000;
        if (remaining <= 0) {
          // 重试请求
          CTWall.retryFeedRequest();
          return;
        }

        // 更新时间显示
        $('.load-error__retry-in').text('' + Math.floor(remaining / 1000));
        setTimeout(timerFn, 1000);
      });

      return timerFn;
    },
    setLoadErrorVisibility: function(visible) {
      // 总之让可能在旋转的图标停下来
      $('.load-error__title__icon').removeClass('fa-spin');

      // 显示或者隐藏加载失败提示
      var container = $('.load-error-outer-container');
      if (visible) {
        container.addClass('visible');
      } else {
        container.removeClass('visible');
      }
    },
    setLoadingIndicatorVisibility: function(visible) {
      var loadingElem = $('.loading-indicator'),
          loadingIconElem = $('.loading-indicator__icon');

      if (visible) {
        loadingElem.addClass('visible');
        loadingIconElem.addClass('fa-spin');
      } else {
        loadingElem.removeClass('visible');
        loadingIconElem.removeClass('fa-spin');
      }
    },
    maybeInitQRCode: function() {
      if (CTWall.state.qrcode !== null) {
        // 已经初始化过了, 什么都不干
        return;
      }

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
    initArticleProgress: function() {
      $('.current-article__timer').knob();
      CTWall.state.articleProgressElem = $('.current-article__timer');
    },
    initFeed: function() {
      // 显示加载提示
      CTWall.setLoadingIndicatorVisibility(true);

      $.getJSON('//' + CTWallConfig.API_DOMAIN + '/v1/feed/week/')
      .done(function(data) {
        console.log('[ctwall] Got feed:', data);

        // 准备新一轮文章展示
        CTWall.onFeedRequestSuccess(data);
      }).fail(function() {
        console.log('feed request failed');

        // 调用失败处理
        CTWall.onFeedRequestFailure();
      }).always(function() {
        // 无论加载成功或失败都隐藏加载提示
        CTWall.setLoadingIndicatorVisibility(false);
      });
    }
  };

  var WallClock = {
    pulse: function() {
      var now = new Date();

      $('.datetime__time__hour').text(zeropad(now.getHours()));
      $('.datetime__time__minute').text(zeropad(now.getMinutes()));
      $('.datetime__date__month').text(zeropad(now.getMonth() + 1));
      $('.datetime__date__day').text(zeropad(now.getDate()));
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

    // 文章进度指示器
    CTWall.initArticleProgress();

    // 初始化新闻条目信息
    CTWall.initMeta();
  });
});


// vim:set ai et ts=2 sw=2 sts=2 fenc=utf-8:
