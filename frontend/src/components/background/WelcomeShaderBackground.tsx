import { PerspectiveCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import ShaderPlaneBackground from './ShaderPlaneBackground';

type WelcomeShaderBackgroundProps = {
  className?: string;
};

export default function WelcomeShaderBackground({
  className = ''
}: WelcomeShaderBackgroundProps) {
  return (
    <div
      aria-hidden='true'
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      <div className='absolute left-1/2 top-0 h-full w-screen -translate-x-1/2'>
        <Canvas
          className='h-full w-full'
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          style={{ display: 'block' }}
        >
          <PerspectiveCamera makeDefault fov={45} position={[0, 0, 10]} />
          <ShaderPlaneBackground />
        </Canvas>
      </div>
    </div>
  );
}
