ctwall
==============

江南听雨餐厅墙

==============


一期工程

目的：提供和现有图片展示完全一样的功能
内容：纯前端，网页制作
时间：1天

二期工程

目的：达到校内其他信息通知平台的功能和体验
内容：显示校务公告和各种学院的公告，集成听雨和后勤集团的失物招领公告，活动展示，等等
时间：再议

（引用自https://github.com/jnrainerds/issue-tracker/issues/10）

不过一期工程的时间方面改为了11天
功能方面...期待有更多转场效果

## 读取[江南大学新闻](http://xinwen.jiangnan.edu.cn/news/)

### API

[http://2.pywejn.sinaapp.com/api/school/news/getlist](http://2.pywejn.sinaapp.com/api/school/news/getlist)

返回数据格式

```jsonp   

jsonpcallback(
[{
	url: "新闻地址",
	picurl: "新闻图片地址(若学校懒到未配图则返回空字符串)",
	title: "新闻标题"
 },
...
])```

**API地址暂时用于测试，需要上线时可修改**


