import { Link } from "react-router-dom";

export default function TermsOfService() {
  return (
    <div className="h-screen overflow-y-auto bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <div className="mb-6">
          <Link to="/auth/login" className="text-blue-600 hover:text-blue-800 text-sm">
            ← 返回登录
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">TAI 用户服务与 AI 使用协议</h1>
        <div className="prose prose-gray max-w-none text-sm leading-relaxed">
          <p className="mb-4">欢迎您使用 TAI！</p>

          <p className="mb-4">
            "TAI"指天宫子午（深圳）科技有限公司（以下简称"我们"或"公司"）合法拥有并运营的、名称为 TAI 的人工智能创意画布平台（包括tgTAI.com及后续可能开发的移动客户端）。
          </p>

          <p className="mb-4">
            在 TAI 中，我们通过创新的节点化工作流（Node-based Workflow），聚合了包括多种全球领先 AI 模型，为用户（以下亦称"您"）提供高度自由的文本、图像、视频、3D 内容生成及编辑服务。
          </p>

          <p className="mb-4">
            在您开始使用 TAI 前，请您务必审慎阅读、充分理解本《TAI 用户服务与 AI 使用协议》（以下简称"本协议"）的各条款内容。特别是涉及免除或者限制责任的条款、法律适用和争议解决条款、以及开通或使用某项特定服务（如付费会员、第三方模型节点）的单独协议或规则。这些条款我们已以粗体或下划线形式提示您重点注意。
          </p>

          <p className="mb-4">
            如您未满 18 周岁，请您在法定监护人陪同下仔细阅读并充分理解本协议，并在征得监护人同意后使用 TAI。
          </p>

          <p className="mb-6 font-medium">
            当您点击"同意"、"注册"、"登录"或实际使用 TAI 提供的服务，即视为您已详细阅读并充分理解本协议，同意作为本协议的一方当事人接受本协议的约束。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第一章 总则</h2>

          <h3 className="font-semibold mb-2">1.1 协议范围</h3>
          <p className="mb-4">
            《TAI 用户服务与 AI 使用协议》（以下称"本协议"）是您与我们订立的，就您下载、安装、打开、注册、登录、使用（以下统称"使用"）TAI 软件及相关事宜约定双方权利义务的协议。
          </p>
          <p className="mb-4">
            请您注意，我们已经发布、后续可能发布的、不时修改的与 TAI 有关的其他相关协议（包括但不限于《隐私政策》、《生成式 AI 服务规则》、《会员服务与自动续费协议》、《侵权投诉指引》）、社区自律公约、活动规则、公告、说明、站内信通知等（合称"平台规则"）均属于本协议不可分割的组成部分，与本协议具有同等法律效力。
          </p>

          <h3 className="font-semibold mb-2">1.2 审慎阅读提示</h3>
          <p className="mb-4">
            请您在开始使用 TAI 之前，认真阅读并充分理解本协议，特别是涉及免除或者限制责任的条款、限制用户权利的条款、权利许可和信息使用的条款、同意开通和使用特殊单项服务的条款（如付费会员、第三方模型节点调用）、法律适用和争议解决条款。我们已将这些重要内容以粗体或下划线字体标注，以便于您识别和重点阅读。
          </p>

          <h3 className="font-semibold mb-2">1.3 适用人群</h3>
          <p className="mb-4">
            TAI 的主要适用人群是成年人。如您未满 18 周岁，请您在监护人陪同下仔细阅读并充分理解本协议，尤其是其中的未成年人使用条款，并在征得监护人同意后使用 TAI。
          </p>

          <h3 className="font-semibold mb-2">1.4 接受协议</h3>
          <p className="mb-4">
            当您点击"同意"、"注册"、"登录"或实际使用 TAI，则视为您已详细阅读并充分理解本协议，同意作为本协议的一方当事人接受本协议的约束。如您不同意本协议的任何内容，您可以选择不使用 TAI。
          </p>

          <h3 className="font-semibold mb-2">1.5 服务性质与第三方服务声明</h3>
          <p className="mb-4">TAI 是一个基于人工智能技术的节点化创意工作流平台（AI Canvas Platform）。</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>核心服务：</strong>我们通过聚合自研算法及第三方模型接口，为您提供多样化的创作节点，包括但不限于文本节点、图像节点、视频节点以及 3D 与辅助编辑节点等。</li>
            <li className="mb-2"><strong>第三方关联：</strong>请您理解，TAI 平台中的部分节点功能是基于第三方服务商提供的模型接口实现的。我们有权依 TAI 产品、服务或运营的需要单方决定，将本协议项下的某些服务交由我们的关联方或第三方提供或运营。</li>
          </ul>

          <h3 className="font-semibold mb-2">1.6 服务变更与风险提示</h3>
          <p className="mb-4">
            鉴于互联网及 AI 技术的快速迭代，以及 TAI 聚合多模型服务的特殊性，您理解并同意，我们有权根据业务发展需要、上游供应商的接口变更等因素调整服务内容。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第二章 账号注册与管理</h2>

          <h3 className="font-semibold mb-2">2.2 账号信息规范</h3>
          <p className="mb-4">您有权自行设置 TAI 账号的昵称、头像、个人简介等信息。</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>禁止假冒：</strong>未经他人明示书面许可，您不得以他人名义开设账号，不得假冒仿冒他人姓名、名称、字号、商标、头像等作为账号信息。</li>
            <li className="mb-2"><strong>违规处理：</strong>我们有权审核您提交的账号信息，如您提交的信息不符合法律法规或本协议约定，我们有权采取警示提醒、限期改正、重置账号信息、限制账号功能、暂停使用、关闭账号、禁止重新注册等处置措施。</li>
          </ul>

          <h3 className="font-semibold mb-2">2.3 账号使用与安全责任</h3>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>仅限本人使用：</strong>您的 TAI 账号仅限您本人使用，禁止以任何形式赠与、借用、出租、转让、售卖或以其他方式许可他人使用该账号。</li>
            <li className="mb-2"><strong>安全保密义务：</strong>您应自行维护账号的安全性与保密性。因您保管不当等自身原因导致您的账号被盗、密码丢失或积分被他人消耗，相应损失需由您自行承担。</li>
          </ul>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第三章 产品及服务使用规范</h2>

          <h3 className="font-semibold mb-2">3.1 核心功能说明</h3>
          <p className="mb-4">TAI 通过可视化的"节点（Node）"连线方式提供服务，功能包括但不限于：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>文本类：</strong>Text Chat Node（纯文本交互）、Prompt Optimizer（提示词优化）</li>
            <li className="mb-2"><strong>图像类：</strong>Image Node、Midjourney Node、Generate Refer、Image Split、Image Grid</li>
            <li className="mb-2"><strong>视频类：</strong>Video Node、Sora2、Wan2.6、Kling、Vidu、Seedance 1.5 Pro、Video Frame Extract、Video Analysis</li>
            <li className="mb-2"><strong>专业工具：</strong>3D Node（三维生成）、Storyboard Split（分镜）等</li>
          </ul>

          <h3 className="font-semibold mb-2">3.4 第三方模型免责声明（重要）</h3>
          <p className="mb-4">您知悉并同意，TAI 平台中的部分高阶节点是基于第三方服务商提供的 API 接口或技术合作实现的。</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>服务依赖性：</strong>如果第三方服务商发生技术故障、调整接口策略、改变定价或停止服务，TAI 有权随之调整、暂停或终止相关节点的功能。</li>
            <li className="mb-2"><strong>生成一致性：</strong>由于第三方 AI 模型的随机性与黑盒特性，TAI 无法保证您在不同时间使用相同参数能获得完全一致的生成结果。</li>
          </ul>

          <h3 className="font-semibold mb-2">3.6 服务更新与变更</h3>
          <p className="mb-4">
            为提升用户体验，或基于整体服务运营、平台安全、合规经营及上游供应商策略调整的需要，我们可能不定期更新或变更 TAI 产品或服务，包括但不限于修改节点参数、升级模型版本、中止或终止特定节点的服务。
          </p>

          <h3 className="font-semibold mb-2">3.7 服务中断与第三方因素免责</h3>
          <p className="mb-4">我们会尽最大努力确保服务的连贯性和安全性，但 TAI 产品及服务可能会受多种因素的影响或干扰。您理解并同意，因下述情况导致服务暂停、中止、终止或造成任何损失的，我们在法律法规允许范围内免于承担责任：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>不可抗力：</strong>包括但不限于政府行为、自然灾害、战争、罢工、骚乱、疫情、基础电信网络中断等</li>
            <li className="mb-2"><strong>第三方服务依赖：</strong>鉴于 TAI 聚合了多个第三方模型接口，因上游服务商发生的故障或变更</li>
          </ul>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第四章 用户行为规范</h2>

          <h3 className="font-semibold mb-2">4.3 禁止输入与生成的违法内容</h3>
          <p className="mb-4">您不得利用 TAI 生成、传播以下违法内容：</p>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-1">反对宪法所确定的基本原则的</li>
            <li className="mb-1">危害国家安全，泄露国家秘密，颠覆国家政权，破坏国家统一的</li>
            <li className="mb-1">损害国家荣誉和利益的</li>
            <li className="mb-1">煽动民族仇恨、民族歧视，破坏民族团结的</li>
            <li className="mb-1">破坏国家宗教政策，宣扬邪教和封建迷信的</li>
            <li className="mb-1">散布谣言，扰乱社会秩序，破坏社会稳定的</li>
            <li className="mb-1">散布淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的</li>
            <li className="mb-1">侮辱或者诽谤他人，侵害他人名誉权、隐私权、肖像权、知识产权或其他合法权益的</li>
            <li className="mb-1">利用深度合成技术制作虚假新闻、实施诈骗、生成 Deepfake 用于非法目的的</li>
            <li className="mb-1">法律、行政法规禁止的其他内容</li>
          </ol>

          <h3 className="font-semibold mb-2">4.4 禁止输入与生成的不良信息</h3>
          <p className="mb-4">除上述违法内容外，您亦不得利用 TAI 生成、传播以下不良内容：</p>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-1"><strong>含有性暗示：</strong>带有性挑逗、性暗示、易使人产生性联想的图片或视频</li>
            <li className="mb-1"><strong>血腥暴力：</strong>展现血腥、惊悚、残忍、密集恐惧等致人身心不适的画面</li>
            <li className="mb-1"><strong>不良导向：</strong>宣扬低俗、庸俗、媚俗内容，或炒作绯闻、丑闻、劣迹的</li>
            <li className="mb-1"><strong>高危行为：</strong>展现自残、自杀、利用危险器械表演或危害自身/他人身心健康的内容</li>
          </ol>

          <h3 className="font-semibold mb-2">4.5 网络安全与反作弊规范</h3>
          <p className="mb-4">您不得对 TAI 平台进行任何形式的技术破坏或恶意使用，包括但不限于：</p>
          <ol className="list-decimal pl-6 mb-4">
            <li className="mb-1"><strong>自动化攻击：</strong>利用插件、外挂、脚本、爬虫工具或其他自动化手段批量调用 API 接口或收集平台数据</li>
            <li className="mb-1"><strong>逆向工程：</strong>对 TAI 平台代码、算法模型、接口协议进行反向工程、反向汇编、编译或尝试发现源代码</li>
            <li className="mb-1"><strong>规避风控：</strong>通过技术手段去除生成内容中强制添加的"AI 生成"水印，或刻意使用字符组合以逃避敏感词技术审核</li>
            <li className="mb-1"><strong>恶意共享：</strong>共享、出租、转借账号以规避平台的并发限制或付费机制</li>
          </ol>

          <h3 className="font-semibold mb-2">4.6 违规处理措施</h3>
          <p className="mb-4">
            如果我们有合理理由认为您的行为违反或可能违反上述约定，我们有权独立进行判断并立即采取措施，包括但不限于警告、限制功能、暂停服务、封禁账号等。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第六章 免责声明与责任限制</h2>

          <h3 className="font-semibold mb-2">6.3 生成结果的随机性</h3>
          <p className="mb-4">
            对于相同的提示词（Prompt），AI 模型每次生成的输出可能存在差异。您理解这属于生成式 AI 的技术特性（概率预测），而非产品故障，平台不保证您在不同时间使用相同参数能获得完全一致的生成结果。
          </p>

          <h3 className="font-semibold mb-2">6.4 用户使用责任与禁止"越狱"</h3>
          <p className="mb-4">鉴于生成式 AI 可能被滥用于违法用途，您承诺在使用 TAI 时严格遵守以下规定：</p>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>禁止诱导违规（反越狱）：</strong>您不得通过设定特定身份、使用特殊提示词或技术手段诱导 AI 突破安全限制</li>
            <li className="mb-2"><strong>禁止非法用途：</strong>您不得利用 TAI 编写钓鱼软件代码、生成网络犯罪方法、制作诽谤信件或进行其他违法犯罪活动</li>
          </ul>

          <h3 className="font-semibold mb-2">6.8-6.11 赔偿责任上限</h3>
          <p className="mb-4">
            尽管我们已经尽了最大努力确保功能服务的连贯性和安全性，但由于现阶段科学技术的局限性，我们无法确保所提供的服务毫无瑕疵。因此，除法律法规另有明确规定外，在任何情况下，我们均不对任何间接性、后果性、惩罚性、偶然性、特殊性或刑罚性的损害承担责任。我们对您承担的全部责任，始终不超过您因使用 TAI 期间而支付给我们的费用（如有）。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第七章 知识产权与内容授权</h2>

          <h3 className="font-semibold mb-2">7.1 TAI 平台的知识产权</h3>
          <p className="mb-4">
            TAI 产品和服务的全部知识产权归我们所有，包括但不限于软件代码、节点架构、算法逻辑、网页设计、文字、图表、电子文档等。特别是 TAI 独创的可视化节点编辑系统及其底层技术，均受著作权法及国际版权公约保护。
          </p>

          <h3 className="font-semibold mb-2">7.6 侵权投诉（通知-删除程序）</h3>
          <p className="mb-4">
            TAI 尊重他人的知识产权。若您认为 TAI 平台上的内容侵犯了您的权利，请依据《侵权投诉指引》将权属证明、身份证明及侵权链接发送至 tgzw@tgTAI.com。我们将按照相关法律法规规定的"通知-删除"程序，及时采取删除、屏蔽、断开链接等必要措施。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第八章 付费服务、积分与结算</h2>

          <h3 className="font-semibold mb-2">8.1 付费服务与定价权</h3>
          <ul className="list-disc pl-6 mb-4">
            <li className="mb-2"><strong>服务类型：</strong>TAI 提供的付费服务包括但不限于"会员订阅"、"积分充值"以及其他增值服务</li>
            <li className="mb-2"><strong>支付协议：</strong>您在购买付费服务前，应仔细阅读并同意单独的《TAI 会员服务与自动续费协议》</li>
          </ul>

          <h3 className="font-semibold mb-2">8.5 未成年人消费提示</h3>
          <p className="mb-4">
            TAI 再次重申，未成年人应在监护人监管下使用本服务。任何未成年人的充值行为均视为已取得监护人的明示同意。如监护人发现未成年人未经同意进行充值，可联系客服申请退款。
          </p>

          <hr className="my-6" />

          <h2 className="text-lg font-bold mt-6 mb-4">第十二章 其他条款</h2>

          <h3 className="font-semibold mb-2">12.4 独立主体关系</h3>
          <p className="mb-4">
            您和我们均是独立的法律主体。在任何情况下，本协议不构成我们对您的任何形式的明示或暗示担保或条件，双方之间亦不构成代理、合伙、合营或雇佣关系。
          </p>

          <h3 className="font-semibold mb-2">12.6 联系我们</h3>
          <p className="mb-4">如您对本协议有任何疑问，或需要投诉举报、申请信息更正/删除，请通过以下方式联系我们：</p>
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
