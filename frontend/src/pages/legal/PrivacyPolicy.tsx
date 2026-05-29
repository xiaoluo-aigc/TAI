import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  return (
    <div className="h-screen overflow-y-auto bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <div className="mb-6">
          <Link to="/auth/login" className="text-blue-600 hover:text-blue-800 text-sm">
            ← 返回登录
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">TAI 隐私政策</h1>
        <div className="prose prose-gray max-w-none text-sm leading-relaxed">
          <p className="mb-4">
            "TAI" 指 天宫子午（深圳）科技有限公司 及其关联方（以下简称"我们"）合法拥有并运营的、名称为 TAI 的客户端应用程序、官方网站（tgtai.com）。
          </p>

          <p className="mb-4">
            我们作为 TAI 的运营者，深知个人信息对您的重要性，我们将按照法律法规的规定，保护您的个人信息及隐私安全。我们制定本隐私政策并特别提示：希望您在使用 TAI 及相关服务前仔细阅读并理解本隐私政策，以便作出适当的选择。
          </p>

          <h2 className="text-lg font-bold mt-6 mb-4">概要</h2>
          <p className="mb-4">
            我们将通过本隐私政策向您介绍不同场景下我们如何处理个人信息。当您开启或使用 TAI 时，为实现您选择使用的功能、服务，或为遵守法律法规的要求，我们会处理相关信息。我们将在隐私政策中逐项说明相关情况，<strong>有关您个人信息权益的重要条款已用加粗形式提示，请特别关注。</strong>
          </p>

          <p className="mb-4">
            除本隐私政策外，在特定场景下，我们还会通过即时告知（含弹窗、页面提示等）、功能更新说明等方式，向您说明对应的信息收集目的、范围及使用方式，这些即时告知及功能更新说明等构成本隐私政策的一部分，并与本隐私政策具有同等效力。
          </p>

          <p className="mb-4">
            下文将帮您详细了解我们如何收集、使用、存储、传输、公开与保护个人信息；帮您了解查询、更正、补充、删除、复制、转移个人信息的方式。其中，<strong>有关您个人信息权益的重要内容已用加粗形式提示，请特别关注。</strong>
          </p>

          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-1">我们如何收集和使用个人信息</li>
            <li className="mb-1">数据使用过程中涉及的合作方以及转移、公开个人信息</li>
            <li className="mb-1">管理您的个人信息</li>
            <li className="mb-1">我们如何保护个人信息的安全</li>
            <li className="mb-1">我们如何存储个人信息</li>
            <li className="mb-1">未成年人条款</li>
            <li className="mb-1">隐私政策的查阅和修订</li>
            <li className="mb-1">联系我们</li>
          </ol>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">1. 我们如何收集和使用个人信息</h2>

          <h3 className="font-semibold mb-2">1.1 账号服务</h3>

          <h4 className="font-medium mb-2">1.1.1 账号注册与实名认证</h4>
          <p className="mb-4">
            您可以通过手机号码注册 TAI 账号。<strong>收集手机号码是履行国家法律法规关于网络实名制（真实身份信息认证）及《生成式人工智能服务管理暂行办法》要求的必要信息。</strong>如果您拒绝提供手机号码用于注册或验证，我们将无法为您提供 AI 内容生成（图片/视频/文本）、Prompt 优化、信息发布等核心功能和服务，您仅可浏览平台公开内容。
          </p>

          <h4 className="font-medium mb-2">1.1.2 第三方登录</h4>
          <p className="mb-4">
            您可以使用第三方账号（如微信、邮箱、Google 等）登录 TAI。当您使用第三方账号登录时，您授权我们获取您在第三方平台的信息（头像、昵称等公开信息以及您授权的其他信息），用于生成与该第三方账号绑定的 TAI 账号。部分情况下（如 AI 生成功能开启时），我们需要重新验证并绑定您的手机号码，以确认该第三方账号的真实性和关联性。
          </p>

          <h4 className="font-medium mb-2">1.1.3 账号公开信息</h4>
          <p className="mb-4">
            您可以自主填写个人简介来完善您的信息。您的关注数、粉丝数、公开发布的工作流（Workflow）及生成作品（Images/Videos）将会在账号的个人主页中公开展示。我们发布违规处罚公告时，会公布违规账号的昵称等去标识化信息。
          </p>

          <h3 className="font-semibold mb-2">1.2 AI 内容生成与编辑服务（核心业务）</h3>

          <h4 className="font-medium mb-2">1.2.1 服务内容与数据收集</h4>
          <p className="mb-4">
            我们基于人工智能（以下简称"AI"）模型技术及可视化节点工作流，向您提供内容生成服务。为了向您提供服务，我们会收集您主动选择、输入或上传的以下信息，包括但不限于：
          </p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>输入内容（Input Data）：</strong>您输入的文本提示词（Prompts）、上传的参考图片、视频素材、3D 模型文件以及您在节点（Node）中配置的参数信息。</li>
            <li className="mb-2"><strong>交互指令：</strong>您在 Text Chat Node 中的对话记录、在 Prompt Optimizer 中的优化指令。</li>
            <li className="mb-2"><strong>生成内容（Output Data）：</strong>平台为您生成的图片、视频、分镜脚本及其元数据（Metadata）。</li>
          </ul>
          <p className="mb-4">
            我们会对上述信息进行分析，以便于更好地为您生成符合您指令和要求的内容。同时，在经过安全加密技术处理、严格去标识化且无法识别特定个人的前提下，我们可能会将所收集的数据（如通用提示词、公开画廊作品）用于 TAI 自研模型的训练、微调（Fine-tuning）及算法测试，并不断调整优化模型的效果。
          </p>

          <h4 className="font-medium mb-2">1.2.2 权限调用</h4>
          <p className="mb-4">
            您在使用 AI 内容生成时（包括但不限于上传参考图、下载生成内容），我们会根据您具体使用到的功能和服务类型请求您授权<strong>本地文档/图片</strong>的权限。如果您拒绝授权，您将无法使用导入素材、导出生成内容等功能，但不影响您使用 TAI 的其他功能。
          </p>

          <h3 className="font-semibold mb-2">1.3 支付与交易服务</h3>
          <p className="mb-4">
            当您购买会员（Subscription）或充值积分时，我们可能会使用 Cookie 来记录您的登录状态、偏好设置（如节点图的缩放比例、默认模型选择）。我们承诺，不会将 Cookie 用于本隐私政策所述目的之外的任何其他用途。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">2. 数据使用过程中涉及的合作方以及转移、公开个人信息</h2>

          <h3 className="font-semibold mb-2">2.1 数据使用过程中涉及的合作方</h3>

          <h4 className="font-medium mb-2">2.1.1 基本原则</h4>
          <p className="mb-4">
            TAI 是一个聚合型 AI 平台，部分核心功能依赖于第三方合作伙伴。我们与合作方合作过程中，将遵守合法、正当、必要及安全审慎原则。
          </p>

          <h4 className="font-medium mb-2">2.1.2 AI 模型服务提供商（核心合作方）</h4>
          <p className="mb-4">
            为了响应您的生成指令，实现文本、图像、视频的生成功能，<strong>我们需要将您的去标识化输入数据（即提示词 Prompt 和参考图 Reference Image，不含您的个人身份信息）传输给相应的模型服务商进行单次推理生成。</strong>您使用特定节点即视为同意该数据传输：
          </p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>文本/图像服务：</strong>通过境内代理接入的 Google (Gemini API) 能力, Midjourney Inc. 能力等。</li>
            <li className="mb-2"><strong>视频服务：</strong>快手 (Kling 可灵), Shengshu (Vidu), Alibaba (Wan2.6), 通过境内代理接入的 OpenAI (Sora2) 能力等。</li>
            <li className="mb-2"><strong>数据用途：</strong>仅用于响应您的生成请求，除非您另行授权，否则我们要求第三方不得将其用于非授权用途。</li>
          </ul>

          <h4 className="font-medium mb-2">2.1.3 支付服务提供商</h4>
          <p className="mb-4">支付功能由与我们合作的第三方支付机构向您提供服务：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>微信支付：</strong>我们与其共享必要的订单信息（商户号、金额）以实现应用内支付。</li>
            <li className="mb-2"><strong>支付宝：</strong>我们与其共享必要的订单信息以实现应用内支付。</li>
          </ul>

          <h3 className="font-semibold mb-2">2.2 跨境传输特别说明</h3>
          <p className="mb-4">
            <strong>TAI 平台接入的部分全球领先 AI 模型能力（如 Gemini，Kling, Sora2, Nano banana 等）均是通过与境内合规第三方代理商合作实现的。</strong>当您使用这些特定节点时，您的输入数据将传输至境内代理商的服务器进行处理。我们承诺仅选择具备合法资质的境内合作伙伴，并要求其严格遵守中国法律法规及安全规范来保护您的数据。TAI 本身不涉及向境外服务器直接传输您的个人信息。
          </p>

          <h3 className="font-semibold mb-2">2.3 运营主体变更</h3>
          <p className="mb-4">
            随着业务的持续发展，我们将有可能进行合并、收购、资产转让，您的个人信息有可能因此而被转移。在发生前述变更时，我们将按照法律法规及不低于本隐私政策所载明的安全标准要求处理您的个人信息。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">3. 管理您的个人信息</h2>
          <p className="mb-4">在以下情形中，您可以向我们提出删除个人信息的请求：</p>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-1">我们处理个人信息的行为违反法律法规；</li>
            <li className="mb-1">我们收集、使用您的个人信息，却未征得您的同意；</li>
            <li className="mb-1">您不再使用我们的产品或服务，或您注销了账号。</li>
          </ol>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">4. 我们如何保护个人信息的安全</h2>
          <p className="mb-4">
            我们采取严格的数据使用和访问制度，确保只有授权人员才可访问您的个人信息。
          </p>

          <h3 className="font-semibold mb-2">4.3 安全提示</h3>
          <p className="mb-4">
            尽管我们已采取必要措施保护您的个人信息安全，但请您理解，在互联网环境下不存在绝对安全的保障措施。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">5. 我们如何存储个人信息</h2>
          <p className="mb-4">
            我们将在中华人民共和国境内收集和产生的个人信息存储在中华人民共和国境内。我们会按照法律法规的要求存储您的个人信息（存储时间不少于三年）。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">6. 未成年人条款</h2>
          <h3 className="font-semibold mb-2">6.1 服务限制</h3>
          <p className="mb-4">
            TAI 的主要适用人群是成年人。如您未满 18 周岁，请您在监护人陪同下仔细阅读并充分理解本隐私政策，并在征得监护人同意后使用 TAI。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">7. 隐私政策的查阅和修订</h2>
          <p className="mb-4">
            我们可能会适时修订本隐私政策。当隐私政策发生重大变更时，我们会通过站内信、弹窗等方式通知您。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">8. 联系我们</h2>
          <p className="mb-4">
            如您对本隐私政策有任何疑问或建议，或需要进行个人信息权利请求，请通过以下方式联系我们，我们将尽快审核您提出的问题或建议，并在验证您的用户身份后的 <strong>15 个工作日</strong>内予以回复：
          </p>
          <div className="bg-gray-50 p-4 rounded-lg mb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-1"><strong>天宫子午（深圳）科技有限公司</strong></p>
                <p className="mb-1">办公地址：广东省深圳市福田区广兰道6号东方河套科技大厦7F</p>
              </div>
              <div className="flex flex-col items-center sm:flex-shrink-0">
                <img
                  src="/gzh.jpg"
                  alt="TAI 公众号"
                  className="h-28 w-28 rounded-md border border-gray-200 object-cover"
                />
                <p className="mt-2 text-xs text-gray-500">公众号</p>
              </div>
            </div>
          </div>

          <p className="text-gray-500 text-sm mt-6">
            本协议最终解释权归天宫子午（深圳）科技有限公司所有
          </p>
        </div>
      </div>
    </div>
  );
}
