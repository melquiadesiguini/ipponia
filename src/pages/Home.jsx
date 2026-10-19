import Header from '../components/Header/Header'
import Footer from '../components/Footer/Footer'
import HeroSection from '../components/Home/HeroSection'
import Caracteristicas from '../components/Home/Caracteristicas'
import '../components/Home/Home.css'

function Home() {
  return (
    <>
      <Header />
      <main className="home-main">
        <HeroSection />
        <Caracteristicas />
        
        {/* Sección CTA */}
        <section className="cta-section">
          <div className="cta-content">
            <h2>¿Listo para tu primer combate?</h2>
            <p>Accede a Ipponia y comienza a registrar combates</p>
            {/* Vuelve al inicio de la portada, donde están los botones de cada módulo */}
            <a
              href="#inicio"
              className="cta-button"
              onClick={(e) => {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Ir a Ipponia
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
export default Home