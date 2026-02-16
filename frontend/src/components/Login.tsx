import { useState } from 'react';
import axios from 'axios';
import { Cpu } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (userData: { name: string; plan: string }) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [isRegistering, setIsRegistering] = useState(false);

  const handleLogin = async (e: any) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    try {
      const res = await axios.post('http://localhost:8080/auth/login', { email, password });
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        onLoginSuccess({ 
          name: email.split('@')[0].toUpperCase(), 
          plan: 'PRO ELITE' 
        });
      }
    } catch (error) {
      alert("Error de acceso: Verifica tus credenciales o el CORS del backend");
    }
  };

  const handleRegister = async (e: any) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:8080/auth/register', {
        email: e.target.email.value,
        fullName: e.target.fullName.value,
        password: e.target.password.value
      });
      alert("¡Registro exitoso! Ya puedes entrar.");
      setIsRegistering(false);
    } catch (error) {
      alert("Error en el registro");
    }
  };

  const inputStyle = { 
    background: '#161a1e', 
    border: '1px solid #2b3139', 
    padding: '14px', 
    borderRadius: '8px', 
    color: 'white', 
    outline: 'none', 
    marginBottom: '15px' 
  };

  return (
    <div style={{ height: '100vh', width: '100vw', background: '#0b0e11', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#1e2329', padding: '40px', borderRadius: '24px', width: '380px', border: '1px solid #2b3139', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(252, 213, 53, 0.1)', borderRadius: '16px', marginBottom: '15px' }}>
            <Cpu color="#FCD535" size={40} />
          </div>
          <h2 style={{ color: 'white', margin: 0, fontSize: '22px', fontWeight: 'bold' }}>AI TRADING TERMINAL</h2>
          <p style={{ color: '#848e9c', fontSize: '14px', marginTop: '8px' }}>
            {isRegistering ? 'Crea tu cuenta de operador' : 'Acceso al sistema central'}
          </p>
        </div>

        <form onSubmit={isRegistering ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
            <label style={{ fontSize: '11px', color: '#848e9c', fontWeight: 'bold' }}>ID DE USUARIO / EMAIL</label>
            <input name="email" type="email" placeholder="operador@crypto-ai.com" required style={inputStyle} />
          </div>

          {isRegistering && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '15px' }}>
              <label style={{ fontSize: '11px', color: '#848e9c', fontWeight: 'bold' }}>NOMBRE DEL OPERADOR</label>
              <input name="fullName" type="text" placeholder="Nombre completo" required style={inputStyle} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '20px' }}>
            <label style={{ fontSize: '11px', color: '#848e9c', fontWeight: 'bold' }}>CLAVE DE ACCESO</label>
            <input name="password" type="password" placeholder="••••••••" required style={inputStyle} />
          </div>

          <button type="submit" style={{ background: '#FCD535', color: 'black', padding: '16px', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', fontSize: '14px', transition: '0.2s' }}>
            {isRegistering ? 'SOLICITAR REGISTRO' : 'ENTRAR AL TERMINAL'}
          </button>
        </form>

        <p onClick={() => setIsRegistering(!isRegistering)} style={{ color: '#FCD535', fontSize: '13px', textAlign: 'center', marginTop: '25px', cursor: 'pointer', fontWeight: '600' }}>
          {isRegistering ? '¿Ya tienes credenciales? Identifícate' : '¿No tienes acceso? Crea una cuenta'}
        </p>
      </div>
    </div>
  );
}
